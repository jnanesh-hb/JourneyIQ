/**
 * JourneyIQ — Express Backend Server
 * 
 * REST API for the JourneyIQ travel planning prototype.
 * Uses synthetic data only — no real transport APIs or bookings.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { planJourney, checkDisruptionImpact, MIN_TRANSFER_BUFFER_MINUTES } = require('./planner');
const { parseRequest, validateRequest, KNOWN_CITIES } = require('./parser');
const { processMessage, getSession, clearSession } = require('./agent');
const { DisruptionEngine } = require('./disruption_engine');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

const DIST_PATH = path.join(__dirname, '../frontend/dist');
app.use(express.static(DIST_PATH));

// Load synthetic data
const DATA_PATH = path.join(__dirname, 'data', 'services.json');
const rawData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const ALL_SERVICES = rawData.services;

// Centralized Disruption Engine instance
const disruptionEngine = new DisruptionEngine(ALL_SERVICES);

// In-memory disruption state (kept in sync with disruptionEngine for legacy compatibility)
let disruptionState = {};

// ─── Trip Store & Decision Audit History ──────────────────────────────────────
const tripStore = new Map();

function getTrip(tripId = 'default-trip') {
  if (!tripStore.has(tripId)) {
    tripStore.set(tripId, {
      id: tripId,
      status: 'planning', // planning | confirmed | disrupted | recovered
      activeItinerary: null,
      confirmedBooking: null,
      history: [
        {
          id: `ev-${Date.now().toString(36)}-init`,
          timestamp: new Date().toISOString(),
          type: 'TRIP_INITIALIZED',
          summary: 'JourneyIQ concierge session created with synthetic transport database.',
          details: { cities_count: KNOWN_CITIES.length, services_count: ALL_SERVICES.length }
        }
      ]
    });
  }
  return tripStore.get(tripId);
}

function recordTripEvent(tripId = 'default-trip', eventType, summary, details = {}) {
  const trip = getTrip(tripId);
  const entry = {
    id: `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    type: eventType,
    summary,
    details,
  };
  trip.history.unshift(entry);
  return entry;
}

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── ENDPOINTS ────────────────────────────────────────────────────────────────

/**
 * GET /health
 * Health check — verifies backend is running and data is loaded
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.1.0',
    app: 'JourneyIQ',
    services_loaded: ALL_SERVICES.length,
    active_disruptions: Object.keys(disruptionState).length,
    supported_cities: KNOWN_CITIES,
    disclaimer: 'SYNTHETIC DATA — This is a hackathon prototype. No real bookings or services.',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /cities
 * Return list of supported cities
 */
app.get('/cities', (req, res) => {
  res.json({
    cities: KNOWN_CITIES,
    disclaimer: 'SYNTHETIC DATA',
  });
});

/**
 * POST /parse
 * Parse a natural-language travel request into structured constraints
 */
app.post('/parse', (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        error: 'Text input is required',
        validation_error: true,
        fieldErrors: { text: 'Natural language text input cannot be empty' },
      });
    }
    const parsed = parseRequest(text);
    const validation = validateRequest(parsed);
    res.json({
      parsed,
      validation,
      note: 'Rule-based parser only. Supported patterns: "from X to Y on YYYY-MM-DD for N passengers budget ₹XXXX"',
    });
  } catch (err) {
    console.error('[Diagnostic Error] /parse failed:', err);
    res.status(500).json({
      error: 'An internal error occurred while parsing the request.',
      technical_error: true,
    });
  }
});

/**
 * POST /search
 * Main journey planning endpoint
 */
app.post('/search', (req, res) => {
  try {
    // Support test simulation of backend technical error
    if (req.query.simulate_error === 'true' || req.body.simulate_backend_error === true) {
      console.warn('[Simulated Failure] /search triggered technical error for testing');
      return res.status(500).json({
        error: 'Simulated backend technical failure: planning service unavailable.',
        technical_error: true,
        diagnostic_id: `SIM-ERR-${Date.now().toString(36)}`,
      });
    }

    const { origin, destination, date, passengers, budget, arrivalDeadline } = req.body;

    // Validate on backend
    const validation = validateRequest({ origin, destination, date, passengers, budget, arrivalDeadline });
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        errors: validation.errors,
        fieldErrors: validation.fieldErrors,
        validation_error: true,
      });
    }

    // Run planner
    const result = planJourney(ALL_SERVICES, {
      origin,
      destination,
      date,
      passengers: passengers ? Number(passengers) : 1,
      budget: budget ? Number(budget) : null,
      arrivalDeadline: arrivalDeadline || null,
    }, disruptionState);

    res.json({
      ...result,
      active_disruptions: Object.keys(disruptionState).length,
      disclaimer: 'SYNTHETIC DATA — All schedules and fares are simulated. No real transport services or bookings.',
    });
  } catch (err) {
    console.error('[Diagnostic Error] /search crashed:', err);
    res.status(500).json({
      error: 'Planning service temporarily encountered a technical error. Please retry.',
      technical_error: true,
      diagnostic_id: `ERR-${Date.now().toString(36)}`,
    });
  }
});

/**
 * POST /disrupt
 * Simulate a disruption on a service, connection, station, or corridor
 */
app.post('/disrupt', (req, res) => {
  try {
    const { service_id, type, delay_minutes } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Disruption type is required', validation_error: true });
    }

    let service = null;
    if (service_id) {
      service = ALL_SERVICES.find(s => s.id === service_id);
      if (!service) {
        return res.status(404).json({ error: `Service ${service_id} not found in synthetic dataset` });
      }
    }

    // Normalize legacy type ('delay' | 'cancel') to engine type
    let engineType = type;
    if (type === 'cancel') {
      engineType = service?.type === 'train' ? 'train_cancellation' : 'bus_cancellation';
    } else if (type === 'delay') {
      engineType = service?.type === 'train' ? 'train_delay' : 'bus_delay';
    }

    const tripId = req.body.trip_id || 'default-trip';
    const trip = getTrip(tripId);
    const activeItinerary = req.body.active_itinerary || trip.activeItinerary;

    const result = disruptionEngine.apply_disruption({
      ...req.body,
      type: engineType,
      service_id,
      delay_minutes,
    }, activeItinerary);

    // Sync legacy state
    disruptionState = disruptionEngine.getLegacyDisruptionState();

    // Update trip status to disrupted
    if (trip.status === 'confirmed') {
      trip.status = 'disrupted';
    }

    recordTripEvent(tripId, 'DISRUPTION_SIMULATED', `Simulated disruption applied: ${result.event.description}`, {
      event_id: result.event.id,
      type: result.event.type,
      impact: result.impact,
    });

    res.json({
      message: result.event.description + ' (simulated)',
      disruption: service_id ? disruptionState[service_id] : null,
      event: result.event,
      impact: result.impact,
      service_id,
      disclaimer: 'SIMULATED DISRUPTION OVERLAY — Not a real operator alert.',
    });
  } catch (err) {
    console.error('[Diagnostic Error] /disrupt failed:', err);
    res.status(400).json({ error: err.message, validation_error: true });
  }
});

/**
 * POST /api/disruptions/apply
 * Dedicated endpoint for applying any of the 12 disruption types
 */
app.post('/api/disruptions/apply', (req, res, next) => {
  req.url = '/disrupt';
  app.handle(req, res, next);
});

/**
 * DELETE /disrupt/:service_id
 * Remove a disruption by service ID or event ID
 */
app.delete('/disrupt/:service_id', (req, res) => {
  const { service_id } = req.params;
  const isEventId = service_id.startsWith('disp-');

  if (isEventId) {
    const resEngine = disruptionEngine.resolve_disruption(service_id);
    disruptionState = disruptionEngine.getLegacyDisruptionState();
    return res.json(resEngine);
  }

  if (disruptionState[service_id] || disruptionEngine.serviceOverrides.has(service_id)) {
    disruptionEngine.serviceOverrides.delete(service_id);
    delete disruptionState[service_id];
    // mark any events for this service as resolved
    for (const ev of disruptionEngine.events.values()) {
      if (ev.target_service_id === service_id) ev.status = 'resolved';
    }
    res.json({ message: `Disruption cleared for ${service_id}` });
  } else {
    res.status(404).json({ error: `No active disruption found for ${service_id}` });
  }
});

/**
 * DELETE /api/disruptions/:id
 */
app.delete('/api/disruptions/:id', (req, res) => {
  const result = disruptionEngine.resolve_disruption(req.params.id);
  disruptionState = disruptionEngine.getLegacyDisruptionState();
  if (result.success) {
    res.json(result);
  } else {
    res.status(404).json(result);
  }
});

/**
 * DELETE /disrupt & POST /api/disruptions/reset
 * Clear all disruptions and reset simulation overlay
 */
const handleResetDisruptions = (req, res) => {
  const resetRes = disruptionEngine.reset_simulation();
  disruptionState = {};
  recordTripEvent('default-trip', 'SIMULATION_RESET', 'All simulated disruptions cleared. Baseline data restored.');
  res.json({
    message: resetRes.message,
    count: 0,
    disclaimer: 'SIMULATION OVERLAY RESET',
  });
};

app.delete('/disrupt', handleResetDisruptions);
app.post('/api/disruptions/reset', handleResetDisruptions);

/**
 * GET /disruptions & GET /api/disruptions/active
 * View current disruption state and active events
 */
const handleGetDisruptions = (req, res) => {
  const activeEvents = disruptionEngine.get_active_disruptions();
  res.json({
    disruptions: disruptionEngine.getLegacyDisruptionState(),
    events: activeEvents,
    count: activeEvents.length,
    unavailable_locations: Array.from(disruptionEngine.unavailableLocations),
    closed_segments: Array.from(disruptionEngine.closedSegments),
    last_confirmed_location: disruptionEngine.lastConfirmedLocation,
    disclaimer: 'SIMULATED DATA OVERLAY',
  });
};

app.get('/disruptions', handleGetDisruptions);
app.get('/api/disruptions/active', handleGetDisruptions);

/**
 * POST /check-disruption & POST /api/disruptions/evaluate
 * Check if a selected itinerary is affected by current disruptions
 */
const handleCheckDisruption = (req, res) => {
  const { itinerary } = req.body;
  if (!itinerary || !itinerary.legs) {
    return res.status(400).json({ error: 'itinerary with legs is required', validation_error: true });
  }
  const impact = disruptionEngine.evaluate_disruption_impact(itinerary);
  res.json({
    affected: impact.affected,
    is_feasible: impact.is_feasible,
    first_failed_connection: impact.first_failed_connection,
    downstream_effects: impact.downstream_effects,
    alerts: impact.alerts,
    recommend_recovery: impact.recommend_recovery,
    impacts: impact.downstream_effects.map(d => ({ reason: d })),
    disclaimer: 'SIMULATED DISRUPTION CHECK',
  });
};

app.post('/check-disruption', handleCheckDisruption);
app.post('/api/disruptions/evaluate', handleCheckDisruption);

/**
 * POST /confirm
 * Explicit confirmation endpoint.
 * Requires user approval. THIS IS A SIMULATION ONLY.
 */
app.post('/confirm', (req, res) => {
  const { itinerary_id, itinerary, passengers } = req.body;

  if (!itinerary) {
    return res.status(400).json({ error: 'itinerary is required for confirmation', validation_error: true });
  }

  // Simulate booking confirmation
  const confirmationId = `DEMO-${Date.now().toString(36).toUpperCase()}`;

  const tripId = req.body.trip_id || 'default-trip';
  const trip = getTrip(tripId);
  trip.status = 'confirmed';
  trip.activeItinerary = itinerary;
  trip.confirmedBooking = {
    confirmation_id: confirmationId,
    itinerary_id,
    passengers: passengers || 1,
    total_cost: itinerary.summary ? itinerary.summary.totalCostAllPassengers : null,
    timestamp: new Date().toISOString(),
  };

  recordTripEvent(tripId, 'BOOKING_SIMULATED', `Simulated booking approved by traveller: ${confirmationId} (${itinerary.legs?.[0]?.origin} → ${itinerary.legs?.[itinerary.legs.length-1]?.destination})`, {
    confirmation_id: confirmationId,
    itinerary_id,
    passengers: passengers || 1,
    cost: trip.confirmedBooking.total_cost,
  });

  res.json({
    confirmed: true,
    confirmation_id: confirmationId,
    itinerary_id,
    passengers: passengers || 1,
    total_cost: itinerary.summary ? itinerary.summary.totalCostAllPassengers : null,
    legs: itinerary.legs ? itinerary.legs.map(l => ({
      service_id: l.service_id,
      origin: l.origin,
      destination: l.destination,
      departure: l.departure,
      arrival: l.arrival,
    })) : [],
    message: 'Your journey has been confirmed (SIMULATED)',
    important_disclaimer: [
      '⚠️ THIS IS A DEMO SIMULATION ONLY',
      'No real booking has been made.',
      'No payment has been processed.',
      'No ticket has been issued.',
      'This prototype uses synthetic schedule data.',
      'JourneyIQ is a SAMARTHA Hackathon prototype.',
    ],
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /services
 * Return all services (for debugging/demo)
 */
app.get('/services', (req, res) => {
  const servicesWithDisruptions = ALL_SERVICES.map(svc => ({
    ...svc,
    disruption: disruptionState[svc.id] || null,
    effective_status: disruptionState[svc.id] ? disruptionState[svc.id].status : svc.status,
  }));
  res.json({
    services: servicesWithDisruptions,
    total: servicesWithDisruptions.length,
    disclaimer: rawData._metadata.disclaimer,
  });
});

// ─── AGENT ENDPOINTS ──────────────────────────────────────────────────────────

/**
 * POST /agent/chat
 * Main agent conversation endpoint.
 * Body: { session_id: string, message: string }
 */
app.post('/agent/chat', async (req, res) => {
  try {
    const { session_id, message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required', validation_error: true });
    }
    const sid = session_id || `session-${Date.now()}`;
    const result = await processMessage(ALL_SERVICES, sid, message.trim(), disruptionState);
    // Sync agent disruption state changes back to server disruption state
    if (result.disruption_state) {
      Object.assign(disruptionState, result.disruption_state);
      // Remove entries that no longer exist in agent's state
      for (const key of Object.keys(disruptionState)) {
        if (!result.disruption_state[key]) delete disruptionState[key];
      }
    }
    res.json(result);
  } catch (err) {
    console.error('[Agent Chat Error]', err);
    res.status(500).json({
      error: 'Agent encountered a technical error.',
      technical_error: true,
      diagnostic_id: `AGENT-ERR-${Date.now().toString(36)}`,
    });
  }
});

/**
 * GET /agent/session/:session_id
 * Retrieve current session state (context, history, state)
 */
app.get('/agent/session/:session_id', (req, res) => {
  const session = getSession(req.params.session_id);
  res.json({
    session_id: req.params.session_id,
    state: session.state,
    context: session.context,
    history_length: session.history.length,
    has_results: !!session.lastSearchResult?.found,
    selected_itinerary: session.selectedItinerary?.id || null,
  });
});

/**
 * DELETE /agent/session/:session_id
 * Clear a session
 */
app.delete('/agent/session/:session_id', (req, res) => {
  clearSession(req.params.session_id);
  res.json({ cleared: true, session_id: req.params.session_id });
});

// ─── SPEC-COMPLIANT /api/... CONTRACT ROUTES ───────────────────────────────────

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.2.0',
    app: 'JourneyIQ',
    services_loaded: ALL_SERVICES.length,
    active_disruptions: Object.keys(disruptionState).length,
    supported_cities: KNOWN_CITIES,
    disclaimer: 'SYNTHETIC DATA — Hackathon prototype. No real bookings.',
    timestamp: new Date().toISOString(),
  });
});

// GET /api/demo/locations & GET /api/cities
app.get(['/api/demo/locations', '/api/cities'], (req, res) => {
  res.json({
    locations: KNOWN_CITIES,
    cities: KNOWN_CITIES,
    total: KNOWN_CITIES.length,
    disclaimer: 'SYNTHETIC DATA — Supported demo hub locations',
  });
});

// POST /api/itineraries/search
app.post('/api/itineraries/search', (req, res, next) => {
  req.url = '/search';
  app.handle(req, res, next);
});

// POST /api/itineraries/validate
app.post('/api/itineraries/validate', (req, res) => {
  const { itinerary, constraints } = req.body;
  if (!itinerary) {
    return res.status(400).json({ error: 'itinerary is required for validation', validation_error: true });
  }
  const result = validateRequest(constraints || {});
  res.json({
    valid: result.valid,
    validation: result,
    itinerary_id: itinerary.id,
    constraints_satisfied: itinerary.constraints_satisfied || {},
  });
});

// POST /api/itineraries/compare
app.post('/api/itineraries/compare', (req, res) => {
  const { options } = req.body;
  if (!options || !Array.isArray(options) || options.length === 0) {
    return res.status(400).json({ error: 'options array is required for comparison', validation_error: true });
  }
  res.json({
    count: options.length,
    compared: options.map((opt, idx) => ({
      rank: idx + 1,
      id: opt.id,
      tag: opt.tag || 'Feasible Option',
      totalFare: opt.summary?.totalFarePerPerson,
      duration: opt.summary?.totalDurationFormatted,
      reliability: opt.reliability_score || 90,
      explanation: opt.explanation || 'Satisfies user travel constraints.',
    })),
    recommendation: options[0]?.id,
    disclaimer: 'SYNTHETIC COMPARISON',
  });
});

// POST /api/disruptions/simulate
app.post('/api/disruptions/simulate', (req, res, next) => {
  req.url = '/disrupt';
  app.handle(req, res, next);
});

// POST /api/journeys/recover
app.post('/api/journeys/recover', (req, res) => {
  try {
    const tripId = req.body.trip_id || 'default-trip';
    const trip = getTrip(tripId);
    const activeItinerary = req.body.active_itinerary || trip.activeItinerary;

    const result = disruptionEngine.recover_journey(ALL_SERVICES, req.body, activeItinerary);

    recordTripEvent(tripId, 'RECOVERY_EVALUATED', `Adaptive recovery evaluated: ${result.recovered_from} → ${req.body.destination}`, {
      found: result.found,
      options_count: result.options?.length,
      recovered_from: result.recovered_from,
      preserved_legs_count: result.preserved_legs?.length || 0,
    });

    res.json({
      success: true,
      found: result.found,
      recovered_from: result.recovered_from,
      preserved_legs: result.preserved_legs,
      options: result.options,
      explanation: result.explanation,
      revision_suggestions: result.revision_suggestions,
      no_route_explanation: result.no_route_explanation,
      disclaimer: 'SYNTHETIC ADAPTIVE RECOVERY — Requires explicit approval.',
    });
  } catch (err) {
    console.error('[Diagnostic Error] /api/journeys/recover failed:', err);
    res.status(500).json({ error: 'Recovery engine encountered technical error.', technical_error: true });
  }
});

// POST /api/disruptions/approve & POST /api/actions/approve
app.post(['/api/disruptions/approve', '/api/actions/approve'], (req, res) => {
  try {
    const { itinerary, trip_id = 'default-trip', passengers = 1 } = req.body;
    if (!itinerary) {
      return res.status(400).json({ error: 'itinerary is required for recovery approval', validation_error: true });
    }

    const trip = getTrip(trip_id);
    trip.activeItinerary = itinerary;
    trip.status = 'recovered';

    recordTripEvent(trip_id, 'RECOVERY_APPROVED', `Traveller approved adaptive recovery plan (${itinerary.legs?.[0]?.origin} → ${itinerary.legs?.[itinerary.legs.length - 1]?.destination})`, {
      itinerary_id: itinerary.id,
      passengers,
      legs_count: itinerary.legs?.length,
      total_cost: itinerary.summary?.totalCostAllPassengers,
    });

    res.json({
      success: true,
      approved: true,
      trip_status: 'recovered',
      active_itinerary: itinerary,
      message: 'Adaptive recovery plan approved and simulated journey updated.',
      disclaimer: 'SIMULATED APPROVAL — No real ticket bookings.',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve recovery itinerary', technical_error: true });
  }
});

// POST /api/disruptions/keep-current & POST /api/actions/reject
app.post(['/api/disruptions/keep-current', '/api/actions/reject'], (req, res) => {
  const tripId = req.body.trip_id || 'default-trip';
  const trip = getTrip(tripId);

  recordTripEvent(tripId, 'RECOVERY_DECLINED', 'Traveller chose to keep current plan without recovery adjustments.');

  res.json({
    success: true,
    approved: false,
    trip_status: trip.status,
    active_itinerary: trip.activeItinerary,
    message: 'Current plan preserved.',
  });
});

// POST /api/actions/confirm
app.post('/api/actions/confirm', (req, res, next) => {
  if (req.body.approved === false || req.body.action === 'reject') {
    return res.status(400).json({
      confirmed: false,
      error: 'Simulated confirmation rejected: explicit approval was not granted.',
      rejection_reason: 'User approval is strictly required before changing active simulated journey.',
    });
  }
  req.url = '/confirm';
  app.handle(req, res, next);
});

// GET /api/trips/:trip_id/status
app.get('/api/trips/:trip_id/status', (req, res) => {
  const trip = getTrip(req.params.trip_id);
  res.json({
    trip_id: req.params.trip_id,
    status: trip.status,
    active_itinerary: trip.activeItinerary,
    confirmed_booking: trip.confirmedBooking,
    active_disruptions_count: Object.keys(disruptionState).length,
    active_disruptions: disruptionState,
    history_events_count: trip.history.length,
    disclaimer: 'SYNTHETIC TRIP STATUS',
  });
});

// GET /api/trips/:trip_id/history
app.get('/api/trips/:trip_id/history', (req, res) => {
  const trip = getTrip(req.params.trip_id);
  res.json({
    trip_id: req.params.trip_id,
    status: trip.status,
    events: trip.history,
    total_events: trip.history.length,
  });
});

// POST /api/trips/:trip_id/reset
app.post('/api/trips/:trip_id/reset', (req, res) => {
  tripStore.delete(req.params.trip_id);
  res.json({ reset: true, trip_id: req.params.trip_id });
});

// POST /api/agent/message
app.post(['/api/agent/message', '/api/agent/chat'], (req, res, next) => {
  req.url = '/agent/chat';
  app.handle(req, res, next);
});

// SPA fallback for frontend routes in production deployment
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && req.path !== '/health') {
    const indexPath = path.join(DIST_PATH, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
  }
  next();
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  console.error('[Unhandled Diagnostic Error]:', err.stack || err);
  res.status(500).json({
    error: 'A technical error occurred. Planning is temporarily unavailable.',
    technical_error: true,
    diagnostic_id: `ERR-${Date.now().toString(36)}`,
  });
});

// ─── START SERVER ──────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║         JourneyIQ — Backend API Server               ║');
    console.log('║         SAMARTHA Hackathon Prototype                  ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  Listening on: http://localhost:${PORT}                   ║`);
    console.log(`║  Services loaded: ${ALL_SERVICES.length}                             ║`);
    console.log('║  ⚠️  SYNTHETIC DATA ONLY — No real bookings          ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
  });
}

module.exports = app;
