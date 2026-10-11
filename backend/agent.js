/**
 * JourneyIQ — Deterministic Agent Controller
 *
 * Implements a stateful travel-concierge agent with explicit tool calls.
 * LLM integration is optional — the same tools work with rule-based intent detection.
 *
 * Tools:
 *   parse_travel_request   — extract structured constraints from natural language
 *   search_itineraries     — find candidate routes from the dataset
 *   validate_itinerary     — verify a single itinerary against constraints
 *   compare_itineraries    — rank feasible options, explain trade-offs
 *   simulate_disruption    — apply delay/cancellation to a service
 *   recover_journey        — replan after disruption, explain what changed
 *   confirm_simulated_option — require explicit approval; return demo confirmation
 */

const { planJourney, checkDisruptionImpact, formatDuration, MIN_TRANSFER_BUFFER_MINUTES } = require('./planner');
const { parseRequest, validateRequest, normalizeCity, KNOWN_CITIES } = require('./parser');

// ─── Session Store (in-memory, keyed by sessionId) ───────────────────────────
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      id: sessionId,
      state: 'idle',  // idle | collecting | search_done | disrupted | awaiting_approval | confirmed
      context: {
        origin: null,
        destination: null,
        date: null,
        passengers: 1,
        budget: null,
        arrivalDeadline: null,
      },
      lastSearchResult: null,
      selectedItinerary: null,
      pendingQuestion: null,  // which field we're waiting on
      disruptionApplied: null,
      history: [],
    });
  }
  return sessions.get(sessionId);
}

function clearSession(sessionId) {
  sessions.delete(sessionId);
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

/**
 * TOOL: parse_travel_request
 * Extract structured constraints from user free-text.
 * Never invents values — returns null for unrecognized fields.
 */
function tool_parse_travel_request(text) {
  const parsed = parseRequest(text);
  return {
    tool: 'parse_travel_request',
    input: text,
    result: parsed,
  };
}

/**
 * TOOL: search_itineraries
 * Find all candidate routes and return Pareto-optimal feasible options.
 * Uses planJourney which already handles disruption state.
 */
function tool_search_itineraries(allServices, context, disruptionState = {}) {
  const validation = validateRequest(context);
  if (!validation.valid) {
    return {
      tool: 'search_itineraries',
      success: false,
      missing_fields: validation.errors,
      field_errors: validation.fieldErrors,
    };
  }

  const result = planJourney(allServices, {
    origin: context.origin,
    destination: context.destination,
    date: context.date,
    passengers: context.passengers || 1,
    budget: context.budget || null,
    arrivalDeadline: context.arrivalDeadline || null,
  }, disruptionState);

  return {
    tool: 'search_itineraries',
    success: true,
    ...result,
  };
}

/**
 * TOOL: validate_itinerary
 * Verify a single itinerary against constraints and return structured diagnostics.
 */
function tool_validate_itinerary(itinerary, context) {
  const checks = {
    budget: true,
    arrival_deadline: true,
    transfer_buffer: true,
    seat_availability: true,
    details: [],
  };

  const passengers = context.passengers || 1;
  const totalCost = itinerary.summary.totalCostAllPassengers;

  if (context.budget && totalCost > context.budget) {
    checks.budget = false;
    checks.details.push(`Cost ₹${totalCost} exceeds budget ₹${context.budget}`);
  }

  if (context.arrivalDeadline) {
    const arrival = new Date(itinerary.summary.arrival);
    const deadline = new Date(context.arrivalDeadline);
    if (arrival > deadline) {
      checks.arrival_deadline = false;
      checks.details.push(`Arrives ${itinerary.summary.arrival.replace('T', ' ')} after deadline`);
    }
  }

  if (itinerary.type === 'multi_leg' && itinerary.summary.transferBufferMinutes < MIN_TRANSFER_BUFFER_MINUTES) {
    checks.transfer_buffer = false;
    checks.details.push(`Transfer buffer ${itinerary.summary.transferBufferMinutes} min < ${MIN_TRANSFER_BUFFER_MINUTES} min minimum`);
  }

  for (const leg of itinerary.legs) {
    if (leg.seats_available < passengers) {
      checks.seat_availability = false;
      checks.details.push(`${leg.service_id} has only ${leg.seats_available} seats (${passengers} needed)`);
    }
  }

  const allPass = Object.entries(checks)
    .filter(([k]) => k !== 'details')
    .every(([, v]) => v === true);

  return {
    tool: 'validate_itinerary',
    itinerary_id: itinerary.id,
    valid: allPass,
    checks,
  };
}

/**
 * TOOL: compare_itineraries
 * Rank feasible options and generate a plain-language trade-off summary for each.
 */
function tool_compare_itineraries(options) {
  if (!options || options.length === 0) {
    return { tool: 'compare_itineraries', success: false, reason: 'No options to compare' };
  }

  const ranked = [...options].sort((a, b) => a.summary.totalFarePerPerson - b.summary.totalFarePerPerson);

  const compared = ranked.map((opt, idx) => {
    const s = opt.summary;
    const isMulti = opt.type === 'multi_leg';
    const legModes = opt.legs.map(l => l.type).join('+');

    // Build concise trade-off label
    const pros = [];
    const cons = [];

    if (idx === 0) pros.push('Cheapest option');
    if (idx === ranked.length - 1 && ranked.length > 1) pros.push('Most expensive');
    if (s.totalDurationMinutes === Math.min(...ranked.map(r => r.summary.totalDurationMinutes))) {
      pros.push('Fastest journey');
    }
    if (s.totalDurationMinutes === Math.max(...ranked.map(r => r.summary.totalDurationMinutes))) {
      cons.push('Longest journey');
    }
    if (s.transfers === 0) pros.push('No transfers needed');
    if (isMulti) {
      cons.push(`Requires transfer at ${s.via} (${s.transferBufferMinutes} min layover)`);
    }

    return {
      rank: idx + 1,
      id: opt.id,
      type: opt.type,
      mode: legModes,
      fare_per_person: s.totalFarePerPerson,
      total_cost: s.totalCostAllPassengers,
      duration: s.totalDurationFormatted,
      departure: s.departure,
      arrival: s.arrival,
      transfers: s.transfers,
      via: s.via || null,
      pros,
      cons,
      summary_line: buildSummaryLine(opt, idx, ranked),
    };
  });

  return {
    tool: 'compare_itineraries',
    success: true,
    count: compared.length,
    compared,
    recommendation: compared[0].id,
    recommendation_reason: compared.length > 1
      ? `${compared[0].id} (${compared[0].mode}) is recommended as the most affordable option at ₹${compared[0].fare_per_person}/person.`
      : `Only one feasible option is available: ${compared[0].summary_line}`,
  };
}

function buildSummaryLine(opt, idx, ranked) {
  const s = opt.summary;
  const type = opt.legs[0].type;
  const icon = type === 'flight' ? '✈️' : type === 'train' ? '🚆' : '🚌';
  const isMulti = opt.type === 'multi_leg';
  return `${icon} ${opt.legs.map(l => l.service_id).join('+')} — ₹${s.totalFarePerPerson}/person, ${s.totalDurationFormatted}${isMulti ? ` via ${s.via}` : ''}, arrives ${s.arrival.split('T')[1].slice(0,5)}`;
}

/**
 * TOOL: simulate_disruption
 * Apply a delay or cancellation to a specific service.
 * Returns the new state of the service and impact analysis.
 */
function tool_simulate_disruption(allServices, serviceId, type, delayMinutes, disruptionState) {
  const service = allServices.find(s => s.id === serviceId);
  if (!service) {
    return { tool: 'simulate_disruption', success: false, error: `Service ${serviceId} not found in synthetic dataset` };
  }

  const newState = { ...disruptionState };

  if (type === 'cancel' || type === 'cancellation' || type === 'bus_cancellation' || type === 'train_cancellation') {
    newState[serviceId] = { status: 'cancelled' };
    return {
      tool: 'simulate_disruption',
      success: true,
      service_id: serviceId,
      disruption_type: 'cancellation',
      description: `Service ${serviceId} (${service.origin}→${service.destination}) has been CANCELLED (simulated).`,
      new_disruption_state: newState,
    };
  } else if (type === 'breakdown' || type === 'vehicle_breakdown') {
    newState[serviceId] = { status: 'breakdown', unusable: true };
    return {
      tool: 'simulate_disruption',
      success: true,
      service_id: serviceId,
      disruption_type: 'vehicle_breakdown',
      description: `Vehicle on service ${serviceId} (${service.origin}→${service.destination}) broke down and is unusable (simulated).`,
      new_disruption_state: newState,
    };
  } else if (type === 'suspension' || type === 'service_suspension') {
    newState[serviceId] = { status: 'suspended', unusable: true };
    return {
      tool: 'simulate_disruption',
      success: true,
      service_id: serviceId,
      disruption_type: 'service_suspension',
      description: `Service ${serviceId} (${service.origin}→${service.destination}) has been suspended (simulated).`,
      new_disruption_state: newState,
    };
  } else if (type === 'delay' || type === 'bus_delay' || type === 'train_delay') {
    const delayMins = parseInt(delayMinutes || 30, 10);
    if (!delayMins || delayMins <= 0) {
      return { tool: 'simulate_disruption', success: false, error: 'delay_minutes must be a positive number' };
    }
    const origDep = new Date(service.departure.endsWith('Z') ? service.departure : service.departure + 'Z');
    const origArr = new Date(service.arrival.endsWith('Z') ? service.arrival : service.arrival + 'Z');
    const newDep = new Date(origDep.getTime() + delayMins * 60000);
    const newArr = new Date(origArr.getTime() + delayMins * 60000);
    const fmt = d => d.toISOString().replace('Z','').split('.')[0];

    newState[serviceId] = {
      status: 'delayed',
      departure: fmt(newDep),
      arrival: fmt(newArr),
      delay_minutes: delayMins,
    };

    return {
      tool: 'simulate_disruption',
      success: true,
      service_id: serviceId,
      disruption_type: 'delay',
      delay_minutes: delayMins,
      original_departure: service.departure,
      new_departure: fmt(newDep),
      description: `Service ${serviceId} (${service.origin}→${service.destination}) is now delayed by ${delayMins} minutes. New departure: ${fmt(newDep).replace('T',' ')}.`,
      new_disruption_state: newState,
    };
  }

  return { tool: 'simulate_disruption', success: false, error: 'Unsupported disruption type' };
}

/**
 * TOOL: recover_journey
 * Rerun the planner with updated disruption state and explain what changed.
 */
function tool_recover_journey(allServices, context, oldResult, newDisruptionState) {
  const newResult = planJourney(allServices, {
    origin: context.origin,
    destination: context.destination,
    date: context.date,
    passengers: context.passengers || 1,
    budget: context.budget || null,
    arrivalDeadline: context.arrivalDeadline || null,
  }, newDisruptionState);

  const oldIds = (oldResult?.options || []).map(o => o.id);
  const newIds = (newResult.options || []).map(o => o.id);
  const lost = oldResult?.options?.filter(o => !newIds.includes(o.id)) || [];
  const gained = newResult.options?.filter(o => !oldIds.includes(o.id)) || [];

  let recoveryNarrative;
  if (newResult.found) {
    recoveryNarrative = `Recovery successful. Found ${newResult.options.length} valid option(s) after disruption.`;
    if (lost.length > 0) {
      recoveryNarrative += ` (${lost.length} option(s) eliminated by disruption.)`;
    }
  } else if (newResult.disruption_recovery_failed) {
    recoveryNarrative = `Recovery failed. The disruption eliminated all available routes. ${newResult.no_route_explanation}`;
  } else {
    recoveryNarrative = `No routes found. ${newResult.no_route_explanation}`;
  }

  return {
    tool: 'recover_journey',
    success: true,
    found: newResult.found,
    options: newResult.options || [],
    disruption_recovery_failed: newResult.disruption_recovery_failed || false,
    disruption_causes: newResult.disruption_causes || [],
    revision_suggestions: newResult.revision_suggestions || [],
    no_route_explanation: newResult.no_route_explanation || null,
    recovery_narrative: recoveryNarrative,
    search_meta: newResult.search_meta,
    eliminated_options: lost.map(o => o.id),
  };
}

/**
 * TOOL: confirm_simulated_option
 * Require explicit approval. Return a clearly-labelled simulated confirmation.
 * Never invents booking details — uses itinerary data only.
 */
function tool_confirm_simulated_option(itinerary, passengers) {
  if (!itinerary) {
    return { tool: 'confirm_simulated_option', success: false, error: 'No itinerary selected for confirmation' };
  }

  const confirmationId = `AGENT-DEMO-${Date.now().toString(36).toUpperCase()}`;
  const s = itinerary.summary;

  return {
    tool: 'confirm_simulated_option',
    success: true,
    confirmed: true,
    confirmation_id: confirmationId,
    itinerary_id: itinerary.id,
    route: `${itinerary.legs[0].origin} → ${itinerary.legs[itinerary.legs.length-1].destination}${s.via ? ` via ${s.via}` : ''}`,
    departure: s.departure,
    arrival: s.arrival,
    duration: s.totalDurationFormatted,
    passengers: passengers || 1,
    total_cost: s.totalCostAllPassengers,
    fare_per_person: s.totalFarePerPerson,
    legs: itinerary.legs.map(l => ({
      service_id: l.service_id,
      operator: l.operator,
      origin: l.origin,
      destination: l.destination,
      departure: l.departure,
      arrival: l.arrival,
    })),
    mandatory_disclaimer: [
      '⚠️ THIS IS A DEMO SIMULATION ONLY — NOT A REAL BOOKING',
      'No payment has been processed.',
      'No actual seat has been reserved.',
      'No ticket has been issued.',
      'JourneyIQ is a SAMARTHA Hackathon prototype using synthetic data.',
    ],
    timestamp: new Date().toISOString(),
  };
}

// ─── Intent Detection (Rule-based, no LLM required) ─────────────────────────

const INTENTS = {
  SEARCH: 'SEARCH',
  DISRUPT_DELAY: 'DISRUPT_DELAY',
  DISRUPT_CANCEL: 'DISRUPT_CANCEL',
  COMPARE: 'COMPARE',
  RECOVER: 'RECOVER',
  SELECT_OPTION: 'SELECT_OPTION',
  CONFIRM_YES: 'CONFIRM_YES',
  CONFIRM_NO: 'CONFIRM_NO',
  CLEAR: 'CLEAR',
  STATUS: 'STATUS',
  HELP: 'HELP',
  ANSWER: 'ANSWER',      // answering a pending question
  UNKNOWN: 'UNKNOWN',
};

function detectIntent(message, session) {
  const lower = message.toLowerCase().trim();

  // Explicit commands first
  if (/^(reset|clear|start over|restart|new search)/.test(lower)) return INTENTS.CLEAR;
  if (/^(help|what can you do|commands)/.test(lower)) return INTENTS.HELP;
  if (/\b(status|current|context|what do you know)\b/.test(lower)) return INTENTS.STATUS;

  // Confirmation
  if (/^(yes|confirm|book|approve|proceed|go ahead|ok|sure)\b/.test(lower)) return INTENTS.CONFIRM_YES;
  if (/^(no|cancel|back|don't|nevermind|reject)\b/.test(lower)) return INTENTS.CONFIRM_NO;

  // Disruption
  if (/\b(cancel|cancelled)\b.*\b(TN|FL|BU)-\w+/.test(message) ||
      /\b(cancel|cancelled)\b.*\b(service|train|flight|bus)\b/.test(lower) ||
      /\bsimulate\s+(a\s+)?cancel/.test(lower)) {
    return INTENTS.DISRUPT_CANCEL;
  }
  if (/\b(delay|delayed)\b/.test(lower) || /\bsimulate\s+(a\s+)?delay/.test(lower)) {
    return INTENTS.DISRUPT_DELAY;
  }

  // Compare / recover
  if (/\b(compare|which is better|cheapest|fastest|trade.?off|recommend)\b/.test(lower)) return INTENTS.COMPARE;
  if (/\b(recover|replan|re-plan|alternatives|what now|find another|after disruption)\b/.test(lower)) return INTENTS.RECOVER;

  // Select a specific option
  const optMatch = lower.match(/\b(option|choice|itin(erary)?)\s*(\d+|one|two|three|first|second|third)\b/) ||
                   lower.match(/\b(itin-\d+|option \d)\b/);
  if (optMatch) return INTENTS.SELECT_OPTION;

  // If awaiting an answer
  if (session.pendingQuestion) return INTENTS.ANSWER;

  // Search: has location keywords or date
  if (/\b(from|to|between|travel|trip|journey|go)\b/.test(lower) ||
      KNOWN_CITIES.some(c => lower.includes(c.toLowerCase())) ||
      /\d{4}-\d{2}-\d{2}/.test(lower) ||
      /\b(october|november|december|january|february|march)\b/.test(lower)) {
    return INTENTS.SEARCH;
  }

  return INTENTS.UNKNOWN;
}

// ─── Missing Field Detection ──────────────────────────────────────────────────

function getMissingFields(context) {
  const missing = [];
  if (!context.origin) missing.push({ field: 'origin', question: 'Where are you travelling from? (e.g. Hyderabad)' });
  if (!context.destination) missing.push({ field: 'destination', question: 'Where do you want to go? (e.g. Chennai)' });
  if (!context.date) missing.push({ field: 'date', question: 'What date are you travelling? (e.g. 2026-10-15)' });
  return missing;
}

// ─── Answer Parsing for Clarification Responses ──────────────────────────────

function applyAnswerToContext(message, pendingField, context) {
  const lower = message.toLowerCase().trim();
  const updated = { ...context };

  if (pendingField === 'origin' || pendingField === 'destination') {
    const city = KNOWN_CITIES.find(c => lower.includes(c.toLowerCase()));
    if (city) {
      updated[pendingField] = city;
      return { updated, success: true };
    }
    // Try aliases
    const aliasMap = { hyd: 'Hyderabad', vizag: 'Visakhapatnam', bombay: 'Mumbai', madras: 'Chennai', calcutta: 'Kolkata', bangalore: 'Bengaluru' };
    for (const [alias, canon] of Object.entries(aliasMap)) {
      if (lower.includes(alias)) { updated[pendingField] = canon; return { updated, success: true }; }
    }
    return { updated, success: false, error: `I don't recognise "${message}" as a supported city. Supported: ${KNOWN_CITIES.join(', ')}` };
  }

  if (pendingField === 'date') {
    const iso = message.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) { updated.date = iso[1] + 'T00:00:00'; return { updated, success: true }; }
    // Try natural dates
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    for (let i = 0; i < months.length; i++) {
      const m = lower.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${months[i]}`));
      if (m) {
        updated.date = `2026-${String(i+1).padStart(2,'0')}-${m[1].padStart(2,'0')}T00:00:00`;
        return { updated, success: true };
      }
    }
    return { updated, success: false, error: 'Please provide the date in YYYY-MM-DD format, e.g. 2026-10-15' };
  }

  if (pendingField === 'passengers') {
    const n = parseInt(message);
    if (!isNaN(n) && n >= 1 && n <= 10) { updated.passengers = n; return { updated, success: true }; }
    return { updated, success: false, error: 'Passenger count must be between 1 and 10' };
  }

  if (pendingField === 'budget') {
    const b = parseInt(message.replace(/[^0-9]/g, ''));
    if (!isNaN(b) && b > 0) { updated.budget = b; return { updated, success: true }; }
    return { updated, success: false, error: 'Please provide a positive number for the budget in INR' };
  }

  return { updated, success: false, error: 'Unknown field to update' };
}

// ─── Context Merge from Parsed NL ────────────────────────────────────────────

function mergeContextFromParsed(context, parsed) {
  const merged = { ...context };
  if (parsed.origin) merged.origin = parsed.origin;
  if (parsed.destination) merged.destination = parsed.destination;
  if (parsed.date) merged.date = parsed.date;
  if (parsed.passengers) merged.passengers = parsed.passengers;
  if (parsed.budget) merged.budget = parsed.budget;
  if (parsed.arrivalDeadline) merged.arrivalDeadline = parsed.arrivalDeadline;
  return merged;
}

// ─── Format Helpers ───────────────────────────────────────────────────────────

function formatTime(isoStr) {
  if (!isoStr) return '—';
  const t = isoStr.includes('T') ? isoStr.split('T')[1] : isoStr;
  return t.slice(0, 5);
}

function formatINR(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

// ─── Response Builders ────────────────────────────────────────────────────────

function buildSearchResponse(searchResult, context, compareResult) {
  if (!searchResult.success) {
    return {
      type: 'error',
      text: `I couldn't run the search: ${searchResult.missing_fields?.join('; ')}`,
    };
  }

  if (!searchResult.found) {
    if (searchResult.disruption_recovery_failed) {
      return {
        type: 'recovery_failed',
        text: searchResult.no_route_explanation,
        disruption_causes: searchResult.disruption_causes,
        revision_suggestions: searchResult.revision_suggestions,
      };
    }
    return {
      type: 'no_route',
      text: searchResult.no_route_explanation || 'No feasible routes found for your constraints.',
      revision_suggestions: searchResult.revision_suggestions || [],
      rejected_details: searchResult.rejected_details || [],
    };
  }

  const opts = compareResult?.compared || [];
  const summary = opts.map((o, i) =>
    `**Option ${i+1}** (${o.id}): ${o.summary_line}`
  ).join('\n');

  return {
    type: 'search_results',
    text: `I found **${searchResult.options.length}** feasible itinerar${searchResult.options.length === 1 ? 'y' : 'ies'} for **${context.origin} → ${context.destination}** on **${context.date?.split('T')[0]}** (${context.passengers} passenger${context.passengers > 1 ? 's' : ''}):\n\n${summary}\n\n${compareResult?.recommendation_reason || ''}\n\nClick an option to select it, or type *compare* for a detailed breakdown. Type a service ID to simulate a disruption (e.g. "delay TN-101 by 120 minutes").`,
    options: searchResult.options,
    compare: compareResult,
    search_meta: searchResult.search_meta,
    rejected_details: searchResult.rejected_details || [],
  };
}

// ─── Main Agent Process Function ──────────────────────────────────────────────

/**
 * Process a user message within a session.
 * Returns a structured agent response with tool call log and message to display.
 */
async function processMessage(allServices, sessionId, userMessage, externalDisruptionState = {}) {
  const session = getSession(sessionId);
  const toolLog = [];

  // Push user message to history
  session.history.push({ role: 'user', content: userMessage });

  let responseMsg;
  let newDisruptionState = { ...externalDisruptionState };

  try {
    const intent = detectIntent(userMessage, session);

    // ── CLEAR ────────────────────────────────────────────────────────────────
    if (intent === INTENTS.CLEAR) {
      clearSession(sessionId);
      return {
        session_id: sessionId,
        intent,
        tool_log: [],
        response: {
          type: 'info',
          text: "I've reset your travel session. What journey can I help you plan? Try: *from Hyderabad to Chennai on 2026-10-15 for 2 passengers*",
        },
        session_state: 'idle',
        context: {},
        disruption_state: newDisruptionState,
      };
    }

    // ── HELP ─────────────────────────────────────────────────────────────────
    if (intent === INTENTS.HELP) {
      return {
        session_id: sessionId,
        intent,
        tool_log: [],
        response: {
          type: 'help',
          text: `**JourneyIQ Travel Agent — Available Actions:**

🔍 **Search**: *"from Hyderabad to Chennai on 2026-10-15 for 2 passengers budget ₹5000"*
📊 **Compare**: Type *compare* after seeing results
⚡ **Disrupt**: *"cancel TN-101"* or *"delay FL-202 by 90 minutes"*
🔄 **Replan**: Type *recover* or *replan* after a disruption
✅ **Confirm**: Select an option then type *confirm* or *yes*
🔄 **Reset**: Type *reset* to start a new search

**Supported cities**: ${KNOWN_CITIES.join(', ')}
**Demo date**: 2026-10-15 (all synthetic schedules run on this date)`,
        },
        session_state: session.state,
        context: session.context,
        disruption_state: newDisruptionState,
      };
    }

    // ── STATUS ───────────────────────────────────────────────────────────────
    if (intent === INTENTS.STATUS) {
      const ctx = session.context;
      const fields = [
        ctx.origin ? `Origin: ${ctx.origin}` : 'Origin: _not set_',
        ctx.destination ? `Destination: ${ctx.destination}` : 'Destination: _not set_',
        ctx.date ? `Date: ${ctx.date.split('T')[0]}` : 'Date: _not set_',
        `Passengers: ${ctx.passengers}`,
        ctx.budget ? `Budget: ${formatINR(ctx.budget)}` : 'Budget: _none_',
        ctx.arrivalDeadline ? `Arrive by: ${ctx.arrivalDeadline}` : 'Arrival deadline: _none_',
      ];
      return {
        session_id: sessionId,
        intent,
        tool_log: [],
        response: { type: 'status', text: `**Current session context:**\n${fields.join('\n')}`, context: ctx },
        session_state: session.state,
        context: session.context,
        disruption_state: newDisruptionState,
      };
    }

    // ── CONFIRM YES ──────────────────────────────────────────────────────────
    if (intent === INTENTS.CONFIRM_YES) {
      if (session.state !== 'awaiting_approval' || !session.selectedItinerary) {
        return buildReply(session, sessionId, intent, toolLog, {
          type: 'info',
          text: 'There is nothing to confirm right now. Please search for a journey first, then select an itinerary.',
        }, newDisruptionState);
      }

      const confirmResult = tool_confirm_simulated_option(session.selectedItinerary, session.context.passengers);
      toolLog.push(confirmResult);
      session.state = 'confirmed';

      return buildReply(session, sessionId, intent, toolLog, {
        type: 'confirmation',
        text: `✅ **Simulated booking confirmed!** Reference: \`${confirmResult.confirmation_id}\`\n\n⚠️ **This is a SAMARTHA Hackathon demo simulation only. No real booking or payment has been made.**`,
        confirmation: confirmResult,
        booking: {
          pnr: confirmResult.confirmation_id,
          passengers: confirmResult.passengers,
          total_cost: confirmResult.total_cost,
          status: confirmResult.status,
        },
      }, newDisruptionState);
    }

    // ── CONFIRM NO ───────────────────────────────────────────────────────────
    if (intent === INTENTS.CONFIRM_NO) {
      session.state = 'search_done';
      session.selectedItinerary = null;
      return buildReply(session, sessionId, intent, toolLog, {
        type: 'info',
        text: 'Approval cancelled. Your search results are still available. Choose a different option or refine your search.',
        options: session.lastSearchResult?.options || [],
      }, newDisruptionState);
    }

    // ── SELECT OPTION ────────────────────────────────────────────────────────
    if (intent === INTENTS.SELECT_OPTION) {
      if (!session.lastSearchResult?.found) {
        return buildReply(session, sessionId, intent, toolLog, {
          type: 'info',
          text: 'No search results to select from. Please search for a journey first.',
        }, newDisruptionState);
      }

      const lower = userMessage.toLowerCase();
      const numMap = { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3 };
      let targetIdx = null;
      const numMatch = lower.match(/(\d+)/);
      if (numMatch) targetIdx = parseInt(numMatch[1]) - 1;
      else {
        for (const [word, num] of Object.entries(numMap)) {
          if (lower.includes(word)) { targetIdx = num - 1; break; }
        }
      }
      const itinMatch = userMessage.match(/itin-(\d+)/i);
      if (itinMatch) targetIdx = parseInt(itinMatch[1]) - 1;

      const opts = session.lastSearchResult.options;
      if (targetIdx === null || targetIdx < 0 || targetIdx >= opts.length) {
        return buildReply(session, sessionId, intent, toolLog, {
          type: 'info',
          text: `Please specify a valid option number (1–${opts.length}).`,
        }, newDisruptionState);
      }

      session.selectedItinerary = opts[targetIdx];
      session.state = 'awaiting_approval';
      const sel = opts[targetIdx];
      const s = sel.summary;

      return buildReply(session, sessionId, intent, toolLog, {
        type: 'approval_request',
        text: `You selected **${sel.id}** — ${sel.legs.map(l=>l.service_id).join('+')} — **${formatINR(s.totalFarePerPerson)}/person** · **${s.totalDurationFormatted}** · arrives **${formatTime(s.arrival)}**.\n\n⚠️ This is a simulated booking. To confirm, type **yes** or **confirm**. To go back, type **no**.`,
        selected_itinerary: sel,
        approval_gate: {
          itinerary_id: sel.id,
          total_cost: s.totalCostAllPassengers,
          passengers: session.context.passengers,
        },
      }, newDisruptionState);
    }

    // ── COMPARE ──────────────────────────────────────────────────────────────
    if (intent === INTENTS.COMPARE) {
      if (!session.lastSearchResult?.found) {
        return buildReply(session, sessionId, intent, toolLog, {
          type: 'info',
          text: 'No results to compare. Please search first.',
        }, newDisruptionState);
      }
      const compareResult = tool_compare_itineraries(session.lastSearchResult.options);
      toolLog.push(compareResult);

      const lines = compareResult.compared.map(c => {
        const pros = c.pros.length > 0 ? `✅ ${c.pros.join(', ')}` : '';
        const cons = c.cons.length > 0 ? `⚠️ ${c.cons.join(', ')}` : '';
        return `**${c.id}** (Rank ${c.rank}): ${c.summary_line}\n${[pros, cons].filter(Boolean).join(' | ')}`;
      }).join('\n\n');

      return buildReply(session, sessionId, intent, toolLog, {
        type: 'comparison',
        text: `**Itinerary Comparison (${compareResult.count} options):**\n\n${lines}\n\n**💡 Recommendation:** ${compareResult.recommendation_reason}`,
        compare: compareResult,
        options: session.lastSearchResult.options,
      }, newDisruptionState);
    }

    // ── DISRUPT (DELAY) ──────────────────────────────────────────────────────
    if (intent === INTENTS.DISRUPT_DELAY) {
      const serviceMatch = userMessage.match(/\b(TN|FL|BU)-\d+\b/i);
      const minuteMatch = userMessage.match(/\b(\d+)\s*(?:min(?:utes?)?|mins?)/i);

      if (!serviceMatch) {
        return buildReply(session, sessionId, intent, toolLog, {
          type: 'info',
          text: 'Which service should I delay? Please specify a service ID (e.g. *delay TN-101 by 120 minutes*).\n\nAvailable services: ' + allServices.map(s=>s.id).slice(0,8).join(', '),
        }, newDisruptionState);
      }

      const serviceId = serviceMatch[0].toUpperCase();
      const delayMins = minuteMatch ? parseInt(minuteMatch[1]) : 90;
      const disruptResult = tool_simulate_disruption(allServices, serviceId, 'delay', delayMins, newDisruptionState);
      toolLog.push(disruptResult);

      if (!disruptResult.success) {
        return buildReply(session, sessionId, intent, toolLog, {
          type: 'error',
          text: disruptResult.error,
        }, newDisruptionState);
      }

      newDisruptionState = disruptResult.new_disruption_state;
      session.disruptionApplied = disruptResult;
      session.state = 'disrupted';

      // Auto-recover if we have a previous search
      let recoveryMsg = '';
      let recoveryResult = null;
      if (session.context.origin && session.context.destination && session.context.date) {
        recoveryResult = tool_recover_journey(allServices, session.context, session.lastSearchResult, newDisruptionState);
        toolLog.push(recoveryResult);
        session.lastSearchResult = recoveryResult;
        recoveryMsg = `\n\n🔄 **Automatic replanning:** ${recoveryResult.recovery_narrative}`;
        if (recoveryResult.eliminated_options?.length > 0) {
          recoveryMsg += `\nEliminated: ${recoveryResult.eliminated_options.join(', ')}`;
        }
      }

      return buildReply(session, sessionId, intent, toolLog, {
        type: 'disruption',
        text: `⚡ **Disruption applied:** ${disruptResult.description}${recoveryMsg}`,
        disruption: disruptResult,
        recovery: recoveryResult,
        options: recoveryResult?.options || [],
        disruption_state: newDisruptionState,
      }, newDisruptionState);
    }

    // ── DISRUPT (CANCEL) ─────────────────────────────────────────────────────
    if (intent === INTENTS.DISRUPT_CANCEL) {
      const serviceMatch = userMessage.match(/\b(TN|FL|BU)-\d+\b/i);

      if (!serviceMatch) {
        return buildReply(session, sessionId, intent, toolLog, {
          type: 'info',
          text: 'Which service should I cancel? Please specify a service ID (e.g. *cancel TN-101*).\n\nAvailable services: ' + allServices.map(s=>s.id).slice(0,8).join(', '),
        }, newDisruptionState);
      }

      const serviceId = serviceMatch[0].toUpperCase();
      const disruptResult = tool_simulate_disruption(allServices, serviceId, 'cancel', null, newDisruptionState);
      toolLog.push(disruptResult);

      if (!disruptResult.success) {
        return buildReply(session, sessionId, intent, toolLog, {
          type: 'error',
          text: disruptResult.error,
        }, newDisruptionState);
      }

      newDisruptionState = disruptResult.new_disruption_state;
      session.disruptionApplied = disruptResult;
      session.state = 'disrupted';

      let recoveryMsg = '';
      let recoveryResult = null;
      if (session.context.origin && session.context.destination && session.context.date) {
        recoveryResult = tool_recover_journey(allServices, session.context, session.lastSearchResult, newDisruptionState);
        toolLog.push(recoveryResult);
        session.lastSearchResult = recoveryResult;
        recoveryMsg = `\n\n🔄 **Automatic replanning:** ${recoveryResult.recovery_narrative}`;
      }

      return buildReply(session, sessionId, intent, toolLog, {
        type: 'disruption',
        text: `❌ **Disruption applied:** ${disruptResult.description}${recoveryMsg}`,
        disruption: disruptResult,
        recovery: recoveryResult,
        options: recoveryResult?.options || [],
        disruption_state: newDisruptionState,
      }, newDisruptionState);
    }

    // ── RECOVER (explicit) ────────────────────────────────────────────────────
    if (intent === INTENTS.RECOVER) {
      if (!session.context.origin) {
        return buildReply(session, sessionId, intent, toolLog, {
          type: 'info',
          text: 'No previous search to recover. Please start with a travel request.',
        }, newDisruptionState);
      }
      const recoveryResult = tool_recover_journey(allServices, session.context, session.lastSearchResult, newDisruptionState);
      toolLog.push(recoveryResult);
      session.lastSearchResult = recoveryResult;

      const compareResult = recoveryResult.found ? tool_compare_itineraries(recoveryResult.options) : null;
      if (compareResult) toolLog.push(compareResult);

      return buildReply(session, sessionId, intent, toolLog, {
        type: recoveryResult.found ? 'search_results' : (recoveryResult.disruption_recovery_failed ? 'recovery_failed' : 'no_route'),
        text: recoveryResult.recovery_narrative + (compareResult ? `\n\n${compareResult.compared.map((o,i) => `**Option ${i+1}**: ${o.summary_line}`).join('\n')}` : ''),
        options: recoveryResult.options || [],
        disruption_causes: recoveryResult.disruption_causes,
        revision_suggestions: recoveryResult.revision_suggestions,
        recovery: recoveryResult,
      }, newDisruptionState);
    }

    // ── ANSWER (to pending question or providing details) ─────────────────────
    if (intent === INTENTS.ANSWER || (session.state === 'collecting' && intent === INTENTS.UNKNOWN)) {
      // First try parsing full travel request from answer
      const parseResult = tool_parse_travel_request(userMessage);
      toolLog.push(parseResult);
      if (parseResult.result?.parsed) {
        session.context = mergeContextFromParsed(session.context, parseResult.result);
      }

      // If pendingQuestion still exists, try direct single-field answer
      if (session.pendingQuestion && (!parseResult.result?.[session.pendingQuestion])) {
        const { updated, success } = applyAnswerToContext(userMessage, session.pendingQuestion, session.context);
        if (success) session.context = updated;
      }

      // Check for remaining missing fields
      const missing = getMissingFields(session.context);
      if (missing.length > 0) {
        session.state = 'collecting';
        session.pendingQuestion = missing[0].field;
        return buildReply(session, sessionId, intent, toolLog, {
          type: 'clarification',
          text: missing[0].question,
          missing_fields: missing.map(m => m.field),
        }, newDisruptionState);
      }

      // All required fields present — run search tool!
      session.pendingQuestion = null;
      const searchResult = tool_search_itineraries(allServices, session.context, newDisruptionState);
      toolLog.push(searchResult);
      const compareResult = searchResult.found ? tool_compare_itineraries(searchResult.options) : null;
      if (compareResult) toolLog.push(compareResult);
      session.lastSearchResult = searchResult;
      session.state = searchResult.found ? 'search_done' : 'idle';

      return buildReply(session, sessionId, intent, toolLog,
        buildSearchResponse(searchResult, session.context, compareResult),
        newDisruptionState);
    }

    // ── SEARCH (main path) ────────────────────────────────────────────────────
    if (intent === INTENTS.SEARCH || intent === INTENTS.UNKNOWN) {
      // Parse the request
      const parseResult = tool_parse_travel_request(userMessage);
      toolLog.push(parseResult);

      // Merge parsed values into context (never overwrite valid existing values with null)
      if (parseResult.result?.parsed) {
        session.context = mergeContextFromParsed(session.context, parseResult.result);
      }

      // Check for missing required fields
      const missing = getMissingFields(session.context);
      if (missing.length > 0) {
        session.state = 'collecting';
        session.pendingQuestion = missing[0].field;

        const filledSummary = [];
        if (session.context.origin) filledSummary.push(`Origin: ${session.context.origin}`);
        if (session.context.destination) filledSummary.push(`Destination: ${session.context.destination}`);
        if (session.context.date) filledSummary.push(`Date: ${session.context.date.split('T')[0]}`);

        const preamble = filledSummary.length > 0 ? `Got it! I have: ${filledSummary.join(', ')}. ` : '';
        return buildReply(session, sessionId, intent, toolLog, {
          type: 'clarification',
          text: preamble + missing[0].question,
          missing_fields: missing.map(m => m.field),
        }, newDisruptionState);
      }

      // All fields present — run search
      const searchResult = tool_search_itineraries(allServices, session.context, newDisruptionState);
      toolLog.push(searchResult);
      const compareResult = searchResult.found ? tool_compare_itineraries(searchResult.options) : null;
      if (compareResult) toolLog.push(compareResult);
      session.lastSearchResult = searchResult;
      session.state = searchResult.found ? 'search_done' : 'idle';

      return buildReply(session, sessionId, intent, toolLog,
        buildSearchResponse(searchResult, session.context, compareResult),
        newDisruptionState);
    }

  } catch (err) {
    console.error('[Agent Error]', err);
    return {
      session_id: sessionId,
      intent: 'ERROR',
      tool_log: toolLog,
      response: {
        type: 'technical_error',
        text: 'The agent encountered a technical error. Please try again.',
        diagnostic: err.message,
      },
      session_state: session.state,
      context: session.context,
      disruption_state: newDisruptionState,
    };
  }
}

function buildReply(session, sessionId, intent, toolLog, response, disruptionState) {
  session.history.push({ role: 'assistant', type: response.type, content: response.text });
  return {
    session_id: sessionId,
    intent,
    tool_log: toolLog,
    response,
    session_state: session.state,
    context: session.context,
    disruption_state: disruptionState,
  };
}

module.exports = { processMessage, getSession, clearSession, KNOWN_CITIES };
