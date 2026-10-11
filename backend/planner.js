/**
 * JourneyIQ — Planner Engine
 * 
 * Pure rule-based, time-aware graph search for transport itinerary planning.
 * No external LLM or real transport API is used.
 * All data is synthetic — see data/services.json disclaimer.
 */

const MIN_TRANSFER_BUFFER_MINUTES = 45; // minimum connection time at any intermediate stop
const MAX_LEGS = 2; // maximum legs in a journey (direct or one-stop)

/**
 * Parse ISO datetime string → Date object
 */
function parseTime(str) {
  return new Date(str);
}

/**
 * Duration in minutes between two Date objects
 */
function minutesBetween(a, b) {
  return (b.getTime() - a.getTime()) / 60000;
}

/**
 * Format minutes as "Xh Ym"
 */
function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Format amount in INR currency
 */
function formatINR(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

/**
 * Check if a service is unusable due to cancellation, suspension, breakdown, or closed corridor
 */
function isServiceUnusable(svc, disruptionState) {
  if (!svc) return true;
  if (svc.unusable === true) return true;
  if (['cancelled', 'suspended', 'breakdown', 'missed', 'route_closed'].includes(svc.status)) return true;
  if (disruptionState) {
    if (disruptionState._unavailableLocations && (
      disruptionState._unavailableLocations.has(svc.origin?.toLowerCase()) ||
      disruptionState._unavailableLocations.has(svc.destination?.toLowerCase())
    )) return true;
    if (disruptionState._closedSegments) {
      const seg = `${svc.origin?.toLowerCase()}::${svc.destination?.toLowerCase()}`;
      if (disruptionState._closedSegments.has(seg)) return true;
    }
  }
  return false;
}

/**
 * Get active services from the dataset, filtering out cancelled/unusable ones
 * unless we're simulating a specific disruption
 */
function getActiveServices(allServices, disruptionState) {
  return allServices.map(svc => {
    // apply any disruption overrides
    if (disruptionState && disruptionState[svc.id]) {
      const override = disruptionState[svc.id];
      return { ...svc, ...override };
    }
    return svc;
  });
}

/**
 * Build direct itineraries: single service from origin to destination
 */
function buildDirectItineraries(services, origin, destination, travelDate, disruptionState = {}) {
  const dateStr = travelDate.split('T')[0]; // YYYY-MM-DD
  
  return services.filter(svc => {
    if (isServiceUnusable(svc, disruptionState)) return false;
    if (svc.origin.toLowerCase() !== origin.toLowerCase()) return false;
    if (svc.destination.toLowerCase() !== destination.toLowerCase()) return false;
    // Must depart on the same date
    const svcDate = svc.departure.split('T')[0];
    return svcDate === dateStr;
  }).map(svc => ({
    type: 'direct',
    legs: [svc],
    totalFare: svc.fare,
    totalDurationMinutes: minutesBetween(parseTime(svc.departure), parseTime(svc.arrival)),
    departure: svc.departure,
    arrival: svc.arrival,
    transfers: 0,
  }));
}

/**
 * Build multi-leg itineraries: two connecting services via an intermediate stop.
 * Explicitly tracks invalid transfers (buffer < 45 min) for failure transparency.
 */
function buildMultiLegItineraries(services, origin, destination, travelDate, disruptionState = {}) {
  const dateStr = travelDate.split('T')[0];
  const itineraries = [];
  const rejectedTransfers = [];

  // Find all services leaving from origin on travel date
  const firstLegs = services.filter(svc => {
    if (isServiceUnusable(svc, disruptionState)) return false;
    if (svc.origin.toLowerCase() !== origin.toLowerCase()) return false;
    const svcDate = svc.departure.split('T')[0];
    return svcDate === dateStr;
  });

  // For each first leg, find connecting services
  for (const leg1 of firstLegs) {
    const via = leg1.destination;
    if (via.toLowerCase() === destination.toLowerCase()) continue; // That's a direct route

    // If transfer station / interchange is unavailable, reject connection
    if (disruptionState?._unavailableLocations?.has(via.toLowerCase())) {
      rejectedTransfers.push({
        route: `${leg1.origin}→${via} (${leg1.id}) + ${via}→${destination}`,
        reasons: [`Transfer interchange at ${via} is unavailable (simulated closed station)`],
      });
      continue;
    }

    const leg1Arrival = parseTime(leg1.arrival);

    // Find services from 'via' to 'destination'
    // Leg 2 must depart within 24 hours of leg 1's arrival (realistic same-day / overnight connection)
    const MAX_LAYOVER_MINUTES = 24 * 60; // 24 hours maximum layover
    const connectingCandidates = services.filter(svc => {
      if (isServiceUnusable(svc, disruptionState)) return false;
      if (svc.origin.toLowerCase() !== via.toLowerCase()) return false;
      if (svc.destination.toLowerCase() !== destination.toLowerCase()) return false;
      // Connecting departure must be after leg1 arrives AND within 24h of leg1 arrival
      const leg2Dep = parseTime(svc.departure);
      const waitMins = minutesBetween(leg1Arrival, leg2Dep);
      return waitMins >= 0 && waitMins <= MAX_LAYOVER_MINUTES;
    });

    for (const leg2 of connectingCandidates) {
      const leg2Departure = parseTime(leg2.departure);
      const transferBuffer = minutesBetween(leg1Arrival, leg2Departure);

      if (transferBuffer < MIN_TRANSFER_BUFFER_MINUTES) {
        // Track rejected connection with clear explanation
        rejectedTransfers.push({
          route: `${leg1.origin}→${via} (${leg1.id}) + ${via}→${destination} (${leg2.id})`,
          reasons: [
            `Insufficient transfer buffer at ${via}: ${Math.round(transferBuffer)} min layover (minimum ${MIN_TRANSFER_BUFFER_MINUTES} min required for safe transfer)`
          ],
        });
        continue; // Never present invalid transfer as feasible
      }

      const leg2Arrival = parseTime(leg2.arrival);
      const totalDurationMinutes = minutesBetween(parseTime(leg1.departure), leg2Arrival);

      itineraries.push({
        type: 'multi_leg',
        legs: [leg1, leg2],
        via,
        totalFare: leg1.fare + leg2.fare,
        totalDurationMinutes,
        departure: leg1.departure,
        arrival: leg2.arrival,
        transfers: 1,
        transferBufferMinutes: Math.round(transferBuffer),
      });
    }
  }

  return { itineraries, rejectedTransfers };
}

/**
 * Validate an itinerary against constraints
 * Returns { valid: boolean, reasons: string[] }
 */
function validateItinerary(itinerary, constraints) {
  const reasons = [];

  // Budget check
  const perPersonFare = itinerary.totalFare;
  const totalCost = perPersonFare * (constraints.passengers || 1);
  if (constraints.budget && totalCost > constraints.budget) {
    reasons.push(`Total cost ₹${totalCost} (${constraints.passengers} pax × ₹${perPersonFare}) exceeds budget of ₹${constraints.budget}`);
  }

  // Arrival deadline check
  if (constraints.arrivalDeadline) {
    const arrival = parseTime(itinerary.arrival);
    const deadline = parseTime(constraints.arrivalDeadline);
    if (arrival > deadline) {
      reasons.push(`Arrives at ${itinerary.arrival.replace('T', ' ')} which is after requested deadline ${constraints.arrivalDeadline.replace('T', ' ')}`);
    }
  }

  // Seat availability for all passengers
  const passengerCount = constraints.passengers || 1;
  for (const leg of itinerary.legs) {
    if (leg.seats_available < passengerCount) {
      reasons.push(`${leg.id} (${leg.origin}→${leg.destination}) only has ${leg.seats_available} seats available (${passengerCount} requested)`);
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

/**
 * Compare itineraries: sort by fare ASC, then duration ASC
 * Apply Pareto filtering to eliminate dominated options
 */
function rankItineraries(itineraries) {
  // Sort: cheaper first; if equal cost, shorter duration first
  const sorted = [...itineraries].sort((a, b) => {
    if (a.totalFare !== b.totalFare) return a.totalFare - b.totalFare;
    return a.totalDurationMinutes - b.totalDurationMinutes;
  });

  // Pareto filtering: remove strictly dominated options
  const paretoFront = [];
  for (const candidate of sorted) {
    let dominated = false;
    for (const existing of paretoFront) {
      if (
        existing.totalFare <= candidate.totalFare &&
        existing.totalDurationMinutes <= candidate.totalDurationMinutes &&
        existing.transfers <= candidate.transfers &&
        (
          existing.totalFare < candidate.totalFare ||
          existing.totalDurationMinutes < candidate.totalDurationMinutes ||
          existing.transfers < candidate.transfers
        )
      ) {
        dominated = true;
        break;
      }
    }
    if (!dominated) {
      paretoFront.push(candidate);
    }
  }

  return paretoFront;
}

/**
 * Format an itinerary for API response
 */
function formatItinerary(itinerary, index, constraints, allOptions = []) {
  const passengerCount = constraints.passengers || 1;
  const totalCost = itinerary.totalFare * passengerCount;

  // Calculate reliability score & risk assessment
  let reliabilityScore = 95;
  const riskNotes = [];

  if (itinerary.type === 'direct') {
    if (itinerary.legs[0].type === 'bus') {
      reliabilityScore = 90;
      riskNotes.push('Direct highway transit; minor traffic variance possible');
    } else if (itinerary.legs[0].type === 'flight') {
      reliabilityScore = 96;
      riskNotes.push('Scheduled aviation corridor with priority boarding');
    } else {
      reliabilityScore = 94;
      riskNotes.push('Dedicated railway corridor; high schedule adherence');
    }
  } else {
    // Multi-leg connection
    const buffer = itinerary.transferBufferMinutes || 0;
    if (buffer >= 90) {
      reliabilityScore = 85;
      riskNotes.push(`Safe ${buffer} min connection window at ${itinerary.via}`);
    } else if (buffer >= 60) {
      reliabilityScore = 78;
      riskNotes.push(`Moderate ${buffer} min transfer window at ${itinerary.via}; sensitive to upstream delays`);
    } else {
      reliabilityScore = 65;
      riskNotes.push(`Tight ${buffer} min transfer buffer at ${itinerary.via}; vulnerable to any primary leg delay`);
    }
  }

  // Determine tag (Cheapest, Fastest, Fewest Transfers, Best Balanced)
  let tag = 'Feasible Option';
  if (allOptions.length > 0) {
    const minFare = Math.min(...allOptions.map(o => o.totalFare));
    const minDuration = Math.min(...allOptions.map(o => o.totalDurationMinutes));
    const minTransfers = Math.min(...allOptions.map(o => o.transfers));

    if (itinerary.totalFare === minFare && itinerary.totalDurationMinutes === minDuration) {
      tag = 'Best Overall';
    } else if (itinerary.totalFare === minFare) {
      tag = 'Cheapest';
    } else if (itinerary.totalDurationMinutes === minDuration) {
      tag = 'Fastest';
    } else if (itinerary.transfers === minTransfers && itinerary.transfers === 0) {
      tag = 'Direct Express';
    } else if (index === 0) {
      tag = 'Best Balanced';
    }
  } else {
    tag = index === 0 ? 'Best Balanced' : (itinerary.type === 'direct' ? 'Direct Express' : 'Connecting Route');
  }

  // Build deterministic grounded explanation
  let explanation = '';
  if (tag === 'Best Overall') {
    explanation = `Recommended as both the most affordable option (₹${itinerary.totalFare}/pax) and fastest journey (${formatDuration(itinerary.totalDurationMinutes)}).`;
  } else if (tag === 'Cheapest') {
    explanation = `Recommended for budget focus: lowest fare at ₹${itinerary.totalFare}/pax (${formatINR(totalCost)} for ${passengerCount} pax), arriving ${itinerary.arrival.split('T')[1].slice(0,5)}.`;
  } else if (tag === 'Fastest') {
    explanation = `Recommended for speed: reaches ${itinerary.legs[itinerary.legs.length-1].destination} in ${formatDuration(itinerary.totalDurationMinutes)} (fastest feasible transit).`;
  } else if (tag === 'Direct Express') {
    explanation = `Direct point-to-point journey with zero station transfers and reliable schedule adherence.`;
  } else {
    explanation = `Satisfies all travel constraints with ${formatDuration(itinerary.totalDurationMinutes)} travel time and ₹${itinerary.totalFare}/pax fare.`;
  }

  return {
    id: `itin-${index + 1}`,
    type: itinerary.type,
    tag,
    explanation,
    reliability_score: reliabilityScore,
    risk_assessment: {
      score: reliabilityScore,
      level: reliabilityScore >= 90 ? 'Low Risk' : reliabilityScore >= 75 ? 'Moderate Risk' : 'High Risk',
      notes: riskNotes,
    },
    legs: itinerary.legs.map(leg => ({
      service_id: leg.id,
      type: leg.type,
      operator: leg.operator,
      origin: leg.origin,
      destination: leg.destination,
      departure: leg.departure,
      arrival: leg.arrival,
      fare_per_person: leg.fare,
      seats_available: leg.seats_available,
      status: leg.status,
      class: leg.class,
    })),
    summary: {
      via: itinerary.via || null,
      transfers: itinerary.transfers,
      totalFarePerPerson: itinerary.totalFare,
      totalCostAllPassengers: totalCost,
      totalDurationMinutes: Math.round(itinerary.totalDurationMinutes),
      totalDurationFormatted: formatDuration(itinerary.totalDurationMinutes),
      departure: itinerary.departure,
      arrival: itinerary.arrival,
      transferBufferMinutes: itinerary.transferBufferMinutes || null,
    },
    constraints_satisfied: {
      budget: !constraints.budget || totalCost <= constraints.budget,
      arrival_deadline: !constraints.arrivalDeadline || new Date(itinerary.arrival) <= new Date(constraints.arrivalDeadline),
      transfer_buffer: itinerary.type === 'direct' || (itinerary.transferBufferMinutes >= MIN_TRANSFER_BUFFER_MINUTES),
      seat_availability: itinerary.legs.every(l => l.seats_available >= passengerCount),
    },
    data_disclaimer: 'SYNTHETIC DATA — Schedules and fares are simulated for demonstration purposes only. Not real transport services.',
  };
}

/**
 * Main planner function
 */
function planJourney(allServices, request, disruptionState = {}) {
  const {
    origin,
    destination,
    date,
    passengers = 1,
    budget = null,
    arrivalDeadline = null,
  } = request;

  const constraints = { passengers, budget, arrivalDeadline };

  // Get services with disruption overrides applied
  const services = getActiveServices(allServices, disruptionState);

  // Build candidate itineraries
  const directOptions = buildDirectItineraries(services, origin, destination, date, disruptionState);
  const { itineraries: multiLegOptions, rejectedTransfers } = buildMultiLegItineraries(services, origin, destination, date, disruptionState);
  const allCandidates = [...directOptions, ...multiLegOptions];

  // Validate against constraints
  const feasible = [];
  const rejected = [];

  for (const itinerary of allCandidates) {
    const validation = validateItinerary(itinerary, constraints);
    if (validation.valid) {
      feasible.push(itinerary);
    } else {
      rejected.push({
        route: itinerary.legs.map(l => `${l.origin}→${l.destination} (${l.id})`).join(' + '),
        reasons: validation.reasons,
      });
    }
  }

  // Add rejected invalid transfers to rejection list
  rejected.push(...rejectedTransfers);

  // Rank feasible options (with Pareto filtering)
  const ranked = rankItineraries(feasible);

  // Format for response with relative ranking context
  const formattedOptions = ranked.map((itin, idx) => formatItinerary(itin, idx, constraints, ranked));

  // Determine failure state details if no options found
  let noRouteExplanation = null;
  let disruptionRecoveryFailed = false;
  let disruptionCauses = [];
  const revisionSuggestions = [];

  if (formattedOptions.length === 0) {
    // Check if baseline (without disruptions) would have had routes
    const hasActiveDisruptions = Object.keys(disruptionState).length > 0;
    if (hasActiveDisruptions) {
      const baselineDirect = buildDirectItineraries(allServices, origin, destination, date);
      const { itineraries: baselineMulti } = buildMultiLegItineraries(allServices, origin, destination, date);
      const baselineFeasible = [...baselineDirect, ...baselineMulti].filter(
        itin => validateItinerary(itin, constraints).valid
      );

      if (baselineFeasible.length > 0) {
        disruptionRecoveryFailed = true;
        disruptionCauses = Object.entries(disruptionState).map(([id, d]) => ({
          service_id: id,
          status: d.status,
          delay_minutes: d.delay_minutes || null,
          description: d.status === 'cancelled'
            ? `Service ${id} was cancelled in simulated disruptions`
            : `Service ${id} was delayed by ${d.delay_minutes} minutes, breaking connecting window`,
        }));
      }
    }

    if (disruptionRecoveryFailed) {
      noRouteExplanation = `Disruption recovery failed: Simulated disruption on service(s) ${disruptionCauses.map(c => c.service_id).join(', ')} invalidated the original route, and no feasible alternative exists in the synthetic dataset under your constraints.`;
      revisionSuggestions.push('Clear active simulated disruptions to restore regular services');
      revisionSuggestions.push('Increase your budget or relax arrival deadline to evaluate other modes');
      revisionSuggestions.push('Try selecting an alternative travel date');
    } else if (allCandidates.length === 0 && rejectedTransfers.length === 0) {
      noRouteExplanation = `No transport services exist in the demo dataset between ${origin} and ${destination} on ${date.split('T')[0]}.`;
      revisionSuggestions.push('Check supported origin and destination pairs (e.g. Visakhapatnam to Vijayawada, Hyderabad to Chennai, Mumbai, or Bengaluru)');
      revisionSuggestions.push('Try the demo travel date: 2026-10-15');
    } else {
      noRouteExplanation = `Found ${allCandidates.length + rejectedTransfers.length} route candidate(s), but none satisfied all constraints.`;
      if (budget) revisionSuggestions.push(`Increase your budget above ₹${budget} or remove the budget filter`);
      if (arrivalDeadline) revisionSuggestions.push(`Relax or remove the arrival deadline (${arrivalDeadline.split('T')[1] || arrivalDeadline})`);
      if (passengers > 1) revisionSuggestions.push(`Reduce passenger count (requested ${passengers} seats)`);
    }
  }

  return {
    found: formattedOptions.length > 0,
    options: formattedOptions,
    rejected_count: rejected.length,
    rejected_details: rejected,
    disruption_recovery_failed: disruptionRecoveryFailed,
    disruption_causes: disruptionCauses,
    revision_suggestions: revisionSuggestions,
    no_route_explanation: noRouteExplanation,
    search_meta: {
      origin,
      destination,
      date,
      passengers,
      budget,
      arrival_deadline: arrivalDeadline,
      candidates_generated: allCandidates.length,
      feasible_before_pareto: feasible.length,
      returned: formattedOptions.length,
      min_transfer_buffer_minutes: MIN_TRANSFER_BUFFER_MINUTES,
    },
  };
}

/**
 * Check if a disruption (delay/cancellation) invalidates any leg or connection of a selected itinerary
 */
function checkDisruptionImpact(selectedItinerary, disruptionState = {}) {
  const affectedLegs = [];

  for (const leg of selectedItinerary.legs) {
    const disruption = disruptionState[leg.service_id];
    if (!disruption) continue;

    if (disruption.status === 'cancelled') {
      affectedLegs.push({
        leg: leg.service_id,
        reason: `Service ${leg.service_id} cancelled`,
        type: 'cancellation'
      });
    } else if (disruption.departure) {
      const origDep = parseTime(leg.departure);
      const newDep = parseTime(disruption.departure);
      const delayMins = minutesBetween(origDep, newDep);
      if (delayMins > 0) {
        affectedLegs.push({
          leg: leg.service_id,
          reason: `Delayed by ${formatDuration(delayMins)}`,
          delayMinutes: delayMins,
          type: 'delay'
        });
      }
    }
  }

  // Also check if primary leg delay breaks multi-leg transfer buffer
  if (selectedItinerary.legs.length > 1) {
    const leg1 = selectedItinerary.legs[0];
    const leg2 = selectedItinerary.legs[1];
    const d1 = disruptionState[leg1.service_id];
    const d2 = disruptionState[leg2.service_id];

    if (d1?.arrival || d2?.departure) {
      const leg1Arr = parseTime(d1?.arrival || leg1.arrival);
      const leg2Dep = parseTime(d2?.departure || leg2.departure);
      const buffer = minutesBetween(leg1Arr, leg2Dep);
      if (buffer < MIN_TRANSFER_BUFFER_MINUTES) {
        affectedLegs.push({
          leg: `${leg1.service_id}→${leg2.service_id}`,
          reason: `Transfer buffer at ${leg1.destination} broken: layover reduced to ${Math.round(buffer)} min (< ${MIN_TRANSFER_BUFFER_MINUTES} min required)`,
          type: 'missed_connection',
          bufferMinutes: Math.round(buffer),
        });
      }
    }
  }

  return affectedLegs;
}

module.exports = {
  planJourney,
  checkDisruptionImpact,
  formatDuration,
  MIN_TRANSFER_BUFFER_MINUTES,
};
