/**
 * JourneyIQ — Centralized Disruption Engine
 * 
 * Manages simulation overlay for all 12 travel disruption types:
 * Transport-service disruptions:
 *   1. Bus delay
 *   2. Train delay
 *   3. Bus cancellation
 *   4. Train cancellation
 *   5. Vehicle breakdown
 *   6. Service suspension
 * Connection disruptions:
 *   7. Missed connection
 *   8. Insufficient transfer time
 *   9. Transfer point unavailable
 * Journey-level disruptions:
 *   10. Route / track closure
 *   11. Last-mile transport unavailable
 *   12. Multiple simultaneous disruptions
 * 
 * Never modifies the underlying transport dataset (1,000+ records).
 * Tracks simulation state in a separate overlay.
 */

const MIN_TRANSFER_BUFFER_MINUTES = 45;

class DisruptionEngine {
  constructor(allServices = []) {
    this.allServices = allServices;
    this.events = new Map(); // id -> DisruptionEvent
    this.serviceOverrides = new Map(); // service_id -> override object
    this.unavailableLocations = new Set(); // set of uppercase location names
    this.closedSegments = new Set(); // set of "ORIGIN::DESTINATION" strings
    this.suspensions = []; // array of { service_id, pattern, startTime, endTime, hours }
    this.lastConfirmedLocation = null;
    this.preservedLegs = [];
  }

  setServices(services) {
    this.allServices = services;
  }

  /**
   * Reset simulation state overlay completely.
   * Underlying transport dataset remains pristine.
   */
  reset_simulation() {
    this.events.clear();
    this.serviceOverrides.clear();
    this.unavailableLocations.clear();
    this.closedSegments.clear();
    this.suspensions = [];
    this.lastConfirmedLocation = null;
    this.preservedLegs = [];
    return {
      message: 'Simulation overlay reset successfully. All synthetic transport records restored to baseline.',
      active_events_count: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get all active disruption events.
   */
  get_active_disruptions() {
    const active = [];
    for (const event of this.events.values()) {
      if (event.status === 'active') {
        active.push(event);
      }
    }
    return active;
  }

  /**
   * Get legacy-compatible disruption state object (service_id -> override).
   */
  getLegacyDisruptionState() {
    const legacy = {};
    for (const [svcId, override] of this.serviceOverrides.entries()) {
      legacy[svcId] = override;
    }
    return legacy;
  }

  /**
   * Check if a service is affected by any active disruption overlay.
   */
  isServiceAffected(service) {
    if (!service) return { affected: false };

    // 1. Direct service override (cancellation, delay, breakdown)
    if (this.serviceOverrides.has(service.id)) {
      const override = this.serviceOverrides.get(service.id);
      return { affected: true, reason: override.reason || override.status, override };
    }

    // 2. Closed route segment
    const segmentKey = `${service.origin.toLowerCase()}::${service.destination.toLowerCase()}`;
    if (this.closedSegments.has(segmentKey)) {
      return {
        affected: true,
        reason: `Route corridor ${service.origin} → ${service.destination} is closed (simulated)`,
        override: { status: 'cancelled', unusable: true },
      };
    }

    // 3. Unavailable location (either origin or destination)
    if (this.unavailableLocations.has(service.origin.toLowerCase()) || this.unavailableLocations.has(service.destination.toLowerCase())) {
      const loc = this.unavailableLocations.has(service.origin.toLowerCase()) ? service.origin : service.destination;
      return {
        affected: true,
        reason: `Station / hub ${loc} is currently unavailable (simulated)`,
        override: { status: 'cancelled', unusable: true },
      };
    }

    // 4. Service suspensions
    for (const susp of this.suspensions) {
      const matchesSvc = susp.service_id ? susp.service_id === service.id : true;
      const matchesMode = susp.mode ? susp.mode.toLowerCase() === service.type?.toLowerCase() : true;
      if (matchesSvc && matchesMode && (susp.service_id || susp.mode)) {
        if (susp.startTime && susp.endTime) {
          const depTime = new Date(service.departure).getTime();
          const sTime = new Date(susp.startTime).getTime();
          const eTime = new Date(susp.endTime).getTime();
          if (depTime >= sTime && depTime <= eTime) {
            return {
              affected: true,
              reason: `Suspended during service suspension window (${susp.startTime} to ${susp.endTime})`,
              override: { status: 'suspended', unusable: true },
            };
          }
        } else if (susp.hours) {
          // Relative hours suspension from service departure day
          return {
            affected: true,
            reason: `Suspended under ${susp.hours}h operational suspension`,
            override: { status: 'suspended', unusable: true },
          };
        }
      }
    }

    return { affected: false };
  }

  /**
   * Apply an active disruption to the simulation overlay.
   */
  apply_disruption(params, activeItinerary = null) {
    const {
      type,
      service_id,
      connection,
      location,
      route_segment,
      delay_minutes,
      start_time,
      end_time,
      suspension_hours,
      last_confirmed_location,
      description,
      itinerary_id,
    } = params;

    const eventId = `disp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const timestamp = new Date().toISOString();

    // Verify service belongs to active itinerary if itinerary provided
    if (service_id && activeItinerary && activeItinerary.legs) {
      const belongs = activeItinerary.legs.some(l => l.service_id === service_id);
      if (!belongs) {
        // Warning: service is valid in dataset, but verify note
        const foundInDataset = this.allServices.find(s => s.id === service_id);
        if (!foundInDataset) {
          throw new Error(`Service ${service_id} not found in synthetic dataset`);
        }
      }
    }

    const event = {
      id: eventId,
      type,
      target_service_id: service_id || null,
      target_connection: connection || null,
      target_location: location || null,
      route_segment: route_segment || null,
      start_time: start_time || null,
      end_time: end_time || null,
      delay_minutes: delay_minutes ? parseInt(delay_minutes, 10) : null,
      severity: 'moderate',
      operational_effect: '',
      description: description || '',
      itinerary_id: itinerary_id || (activeItinerary?.id) || 'active-itinerary',
      timestamp,
      status: 'active',
      last_confirmed_location: last_confirmed_location || null,
      simulated_data_label: 'SIMULATED DATA — Not an actual transport operator notice',
    };

    // Apply specific disruption logic
    switch (type) {
      case 'bus_delay':
      case 'train_delay': {
        if (!service_id) throw new Error('service_id is required for delay disruptions');
        const svc = this.allServices.find(s => s.id === service_id);
        if (!svc) throw new Error(`Service ${service_id} not found`);
        const delay = parseInt(delay_minutes || 45, 10);
        if (isNaN(delay) || delay <= 0) throw new Error('delay_minutes must be a positive number');

        const origDep = new Date(svc.departure.endsWith('Z') ? svc.departure : svc.departure + 'Z');
        const origArr = new Date(svc.arrival.endsWith('Z') ? svc.arrival : svc.arrival + 'Z');
        const newDep = new Date(origDep.getTime() + delay * 60000);
        const newArr = new Date(origArr.getTime() + delay * 60000);
        const fmt = d => d.toISOString().replace('Z', '').split('.')[0];

        this.serviceOverrides.set(service_id, {
          status: 'delayed',
          departure: fmt(newDep),
          arrival: fmt(newArr),
          delay_minutes: delay,
          original_departure: svc.departure,
          original_arrival: svc.arrival,
          reason: `${svc.type?.toUpperCase()} service delayed by ${delay} min`,
        });

        event.delay_minutes = delay;
        event.operational_effect = `Departure deferred to ${fmt(newDep).replace('T', ' ')}; Arrival at ${fmt(newArr).replace('T', ' ')}`;
        event.description = event.description || `${svc.type === 'bus' ? 'Bus' : 'Train'} service ${service_id} delayed by ${delay} min (+${delay}m)`;
        event.severity = delay >= 60 ? 'severe' : 'moderate';
        break;
      }

      case 'bus_cancellation':
      case 'train_cancellation': {
        if (!service_id) throw new Error('service_id is required for cancellation disruptions');
        const svc = this.allServices.find(s => s.id === service_id);
        if (!svc) throw new Error(`Service ${service_id} not found`);

        this.serviceOverrides.set(service_id, {
          status: 'cancelled',
          unusable: true,
          reason: `${svc.type?.toUpperCase()} service cancelled`,
        });

        event.operational_effect = `Service ${service_id} marked as cancelled and excluded from recovery routes`;
        event.description = event.description || `${svc.type === 'bus' ? 'Bus' : 'Train'} service ${service_id} has been cancelled`;
        event.severity = 'critical';
        break;
      }

      case 'vehicle_breakdown': {
        if (!service_id) throw new Error('service_id is required for breakdown simulation');
        const svc = this.allServices.find(s => s.id === service_id);
        if (!svc) throw new Error(`Service ${service_id} not found`);

        // Determine confirmed reachable location
        let confirmedLoc = last_confirmed_location;
        if (!confirmedLoc && activeItinerary && activeItinerary.legs) {
          // If leg 1 completed, confirmed location could be transfer point; otherwise origin
          const legIdx = activeItinerary.legs.findIndex(l => l.service_id === service_id);
          if (legIdx > 0) {
            confirmedLoc = activeItinerary.legs[legIdx - 1].destination;
          } else {
            confirmedLoc = svc.origin;
          }
        }
        confirmedLoc = confirmedLoc || svc.origin;

        this.serviceOverrides.set(service_id, {
          status: 'breakdown',
          unusable: true,
          breakdown_location: confirmedLoc,
          reason: `Vehicle broke down and is unusable. Last confirmed reachable location: ${confirmedLoc}`,
        });

        this.lastConfirmedLocation = confirmedLoc;
        event.last_confirmed_location = confirmedLoc;
        event.operational_effect = `Vehicle unusable mid-transit. Replan begins from last confirmed location: ${confirmedLoc}`;
        event.description = event.description || `Vehicle breakdown on ${service_id}. Completed legs preserved, replanning from ${confirmedLoc}`;
        event.severity = 'critical';
        break;
      }

      case 'service_suspension': {
        const hours = suspension_hours ? parseInt(suspension_hours, 10) : 4;
        const susp = {
          service_id: service_id || null,
          mode: params.mode || null,
          startTime: start_time || null,
          endTime: end_time || null,
          hours,
        };
        this.suspensions.push(susp);

        if (service_id) {
          this.serviceOverrides.set(service_id, {
            status: 'suspended',
            unusable: true,
            reason: `Service suspended for ${hours} hours`,
          });
        }

        event.operational_effect = `Service departures suspended during maintenance/safety window (${hours}h)`;
        event.description = event.description || `Service suspension applied (${hours} hour window)`;
        event.severity = 'severe';
        break;
      }

      case 'missed_connection': {
        // Connection failure between two legs
        let connStr = connection;
        let transferHub = location;
        if (!connStr && activeItinerary && activeItinerary.legs?.length > 1) {
          connStr = `${activeItinerary.legs[0].service_id} → ${activeItinerary.legs[1].service_id}`;
          transferHub = transferHub || activeItinerary.legs[0].destination;
        }

        if (service_id) {
          // Mark onward service as missed
          this.serviceOverrides.set(service_id, {
            status: 'missed',
            unusable: true,
            reason: `Onward connection missed due to delay on incoming service`,
          });
        }

        transferHub = transferHub || (activeItinerary?.legs?.[0]?.destination) || 'Transfer Hub';
        this.lastConfirmedLocation = transferHub;

        event.target_connection = connStr || 'Transfer Connection';
        event.target_location = transferHub;
        event.last_confirmed_location = transferHub;
        event.operational_effect = `Connecting departure departed before arrival. Journey broken at ${transferHub}`;
        event.description = event.description || `Missed connection at ${transferHub} (${connStr}). Replanning from ${transferHub}`;
        event.severity = 'critical';
        break;
      }

      case 'insufficient_transfer_time': {
        // Insufficient transfer buffer at interchange
        const transferHub = location || (activeItinerary?.legs?.[0]?.destination) || 'Interchange';
        if (service_id) {
          // Mark as connection buffer failure
          this.serviceOverrides.set(service_id, {
            status: 'infeasible_buffer',
            reason: `Transfer buffer under minimum ${MIN_TRANSFER_BUFFER_MINUTES} min at ${transferHub}`,
          });
        }

        event.target_location = transferHub;
        event.operational_effect = `Connection violates ${MIN_TRANSFER_BUFFER_MINUTES} min safe transfer buffer`;
        event.description = event.description || `Insufficient transfer buffer at ${transferHub}; marked infeasible`;
        event.severity = 'moderate';
        break;
      }

      case 'transfer_point_unavailable': {
        const hub = location || (activeItinerary?.legs?.[0]?.destination) || (activeItinerary?.summary?.via);
        if (!hub) throw new Error('location (station/interchange name) is required for transfer point disruption');

        this.unavailableLocations.add(hub.toLowerCase());
        event.target_location = hub;
        event.operational_effect = `Transfer station / interchange at ${hub} is closed. All transfers via ${hub} excluded`;
        event.description = event.description || `Transfer point ${hub} is unavailable. Searching for routes avoiding ${hub}`;
        event.severity = 'severe';
        break;
      }

      case 'route_closure': {
        let seg = route_segment;
        if (!seg && activeItinerary && activeItinerary.legs) {
          const l = activeItinerary.legs[0];
          seg = `${l.origin}::${l.destination}`;
        }
        if (!seg && location) {
          seg = location;
        }
        if (!seg) throw new Error('route_segment or corridor endpoints required for route closure');

        const parts = seg.toLowerCase().split(/[::\s➔→-]+/);
        const origin = parts[0]?.trim();
        const destination = parts[parts.length - 1]?.trim();
        const segKey = `${origin}::${destination}`;
        this.closedSegments.add(segKey);

        // Mark any services on this segment
        for (const s of this.allServices) {
          if (s.origin.toLowerCase() === origin && s.destination.toLowerCase() === destination) {
            this.serviceOverrides.set(s.id, {
              status: 'route_closed',
              unusable: true,
              reason: `Corridor ${s.origin} → ${s.destination} closed due to track/road closure`,
            });
          }
        }

        event.route_segment = `${origin} ➔ ${destination}`;
        event.operational_effect = `Corridor ${origin} ➔ ${destination} closed. Services on this segment excluded`;
        event.description = event.description || `Route / track segment between ${origin} and ${destination} closed (simulated)`;
        event.severity = 'severe';
        break;
      }

      case 'last_mile_unavailable': {
        // Last connecting leg service is cancelled
        let lastSvcId = service_id;
        if (!lastSvcId && activeItinerary && activeItinerary.legs) {
          lastSvcId = activeItinerary.legs[activeItinerary.legs.length - 1].service_id;
        }
        if (!lastSvcId) throw new Error('service_id for final leg required for last-mile disruption');

        this.serviceOverrides.set(lastSvcId, {
          status: 'cancelled',
          unusable: true,
          reason: 'Last-mile feeder / onward connection cancelled or unavailable',
        });

        event.target_service_id = lastSvcId;
        event.operational_effect = `Final connecting service ${lastSvcId} unavailable. Searching for alternative final leg`;
        event.description = event.description || `Last-mile transport service ${lastSvcId} unavailable`;
        event.severity = 'critical';
        break;
      }

      case 'multiple_disruptions': {
        // Compound disruption handled by multiple events
        event.operational_effect = 'Multiple simultaneous disruption scenario active';
        event.description = description || 'Multiple simultaneous travel incidents impacting journey';
        event.severity = 'severe';
        break;
      }

      default:
        throw new Error(`Unsupported disruption type: ${type}`);
    }

    this.events.set(eventId, event);

    // Evaluate impact on itinerary
    const impact = this.evaluate_disruption_impact(activeItinerary);

    return {
      event,
      impact,
      active_events_count: this.get_active_disruptions().length,
    };
  }

  /**
   * Evaluate the impact of all active disruptions on a specific itinerary.
   */
  evaluate_disruption_impact(itinerary) {
    if (!itinerary || !itinerary.legs || itinerary.legs.length === 0) {
      return {
        affected: false,
        is_feasible: true,
        first_failed_connection: null,
        downstream_effects: [],
        alerts: [],
        recommend_recovery: false,
        simulated_data_label: 'SIMULATED DISRUPTION CHECK',
      };
    }

    const downstreamEffects = [];
    let firstFailed = null;
    let isFeasible = true;
    const legStatus = [];

    // Helper: parse date
    const toDate = s => new Date(s.endsWith('Z') ? s : s + 'Z');

    let currentAccumulatedDelay = 0;

    for (let i = 0; i < itinerary.legs.length; i++) {
      const leg = itinerary.legs[i];
      const override = this.serviceOverrides.get(leg.service_id);
      const isClosedSegment = this.closedSegments.has(`${leg.origin.toLowerCase()}::${leg.destination.toLowerCase()}`);
      const isHubUnavailable = this.unavailableLocations.has(leg.origin.toLowerCase()) || this.unavailableLocations.has(leg.destination.toLowerCase());

      let legFeasible = true;
      let legIssue = null;

      // Check cancellation / breakdown / closed corridor
      if (override?.status === 'cancelled' || override?.unusable) {
        legFeasible = false;
        legIssue = `Service ${leg.service_id} (${leg.origin}→${leg.destination}) is ${override.status.toUpperCase()}`;
        const failType = override.status === 'route_closed' ? 'route_closure' : override.status;
        if (!firstFailed) firstFailed = { leg_index: i, service_id: leg.service_id, reason: legIssue, type: failType };
      } else if (isClosedSegment) {
        legFeasible = false;
        legIssue = `Track/road corridor ${leg.origin} → ${leg.destination} is CLOSED`;
        if (!firstFailed) firstFailed = { leg_index: i, service_id: leg.service_id, reason: legIssue, type: 'route_closure' };
      } else if (isHubUnavailable) {
        legFeasible = false;
        legIssue = `Station / hub at ${leg.destination} is UNAVAILABLE`;
        if (!firstFailed) firstFailed = { leg_index: i, service_id: leg.service_id, reason: legIssue, type: 'transfer_point_unavailable' };
      }

      // Check delay
      let effDep = toDate(leg.departure);
      let effArr = toDate(leg.arrival);

      if (override?.delay_minutes) {
        currentAccumulatedDelay += override.delay_minutes;
        effDep = new Date(effDep.getTime() + override.delay_minutes * 60000);
        effArr = new Date(effArr.getTime() + override.delay_minutes * 60000);
        downstreamEffects.push(`Leg ${i + 1} (${leg.service_id}) delayed by ${override.delay_minutes}m (New Arr: ${effArr.toISOString().substring(11, 16)})`);
      }

      legStatus.push({
        leg_index: i,
        service_id: leg.service_id,
        feasible: legFeasible,
        issue: legIssue,
        effective_departure: effDep.toISOString(),
        effective_arrival: effArr.toISOString(),
      });

      if (!legFeasible) {
        isFeasible = false;
      }
    }

    // Check connections in multi-leg journeys
    if (itinerary.legs.length > 1) {
      for (let i = 0; i < itinerary.legs.length - 1; i++) {
        const leg1Status = legStatus[i];
        const leg2Status = legStatus[i + 1];
        const leg1Arr = new Date(leg1Status.effective_arrival);
        const leg2Dep = new Date(leg2Status.effective_departure);
        const bufferMins = (leg2Dep.getTime() - leg1Arr.getTime()) / 60000;
        const transferCity = itinerary.legs[i].destination;

        // Check if transfer hub unavailable
        if (this.unavailableLocations.has(transferCity.toLowerCase())) {
          isFeasible = false;
          const msg = `Transfer point ${transferCity} is unavailable`;
          downstreamEffects.push(msg);
          if (!firstFailed) firstFailed = { leg_index: i, connection: `${itinerary.legs[i].service_id}→${itinerary.legs[i+1].service_id}`, reason: msg, type: 'transfer_point_unavailable' };
        } else if (bufferMins < 0) {
          isFeasible = false;
          const msg = `Missed connection at ${transferCity}: preceding arrival (${leg1Arr.toISOString().substring(11, 16)}) is AFTER connecting departure (${leg2Dep.toISOString().substring(11, 16)}) by ${Math.abs(Math.round(bufferMins))} min`;
          downstreamEffects.push(msg);
          if (!firstFailed) firstFailed = { leg_index: i, connection: `${itinerary.legs[i].service_id}→${itinerary.legs[i+1].service_id}`, reason: msg, type: 'missed_connection' };
        } else if (bufferMins < MIN_TRANSFER_BUFFER_MINUTES) {
          isFeasible = false;
          const msg = `Insufficient transfer buffer at ${transferCity}: layover reduced to ${Math.round(bufferMins)}m (below safe minimum of ${MIN_TRANSFER_BUFFER_MINUTES}m)`;
          downstreamEffects.push(msg);
          if (!firstFailed) firstFailed = { leg_index: i, connection: `${itinerary.legs[i].service_id}→${itinerary.legs[i+1].service_id}`, reason: msg, type: 'insufficient_transfer_time' };
        }
      }
    }

    // Check last-mile breakdown
    if (this.lastConfirmedLocation) {
      downstreamEffects.push(`Journey interrupted mid-transit. Validated reachable point: ${this.lastConfirmedLocation}`);
    }

    // Build structured alert
    const alerts = [];
    if (!isFeasible) {
      alerts.push({
        alert_level: 'critical',
        type: firstFailed?.type || 'disruption_detected',
        title: '⚠️ Journey Infeasible Due to Simulated Disruption',
        message: firstFailed?.reason || 'One or more connections on this itinerary are no longer feasible.',
        first_failed_connection: firstFailed?.connection || firstFailed?.service_id || null,
        downstream_effects: downstreamEffects,
        recovery_available: true,
        simulated_data_label: 'SIMULATED DATA — For demonstration only',
      });
    } else if (currentAccumulatedDelay > 0) {
      alerts.push({
        alert_level: 'warning',
        type: 'delay_absorbed',
        title: '⏱️ Service Delayed — Connection Still Feasible',
        message: `A delay of ${currentAccumulatedDelay} minutes was absorbed by the available transfer window. The journey remains feasible.`,
        downstream_effects: downstreamEffects,
        recovery_available: false,
        simulated_data_label: 'SIMULATED DATA — For demonstration only',
      });
    }

    return {
      affected: !isFeasible || currentAccumulatedDelay > 0,
      is_feasible: isFeasible,
      first_failed_connection: firstFailed,
      downstream_effects: downstreamEffects,
      leg_statuses: legStatus,
      alerts,
      recommend_recovery: !isFeasible,
      simulated_data_label: 'SIMULATED DISRUPTION CHECK',
    };
  }

  /**
   * Validate remaining journey from the specified leg index or confirmed location.
   */
  validate_remaining_journey(itinerary) {
    const impact = this.evaluate_disruption_impact(itinerary);
    return {
      feasible: impact.is_feasible,
      first_failure: impact.first_failed_connection,
      failure_reasons: impact.downstream_effects,
      leg_statuses: impact.leg_statuses,
    };
  }

  /**
   * Recover journey by replanning from the current/last confirmed reachable location
   * to the final destination, excluding broken services, closed corridors, and unavailable transfer points.
   */
  recover_journey(allServices, searchParams, activeItinerary = null) {
    const {
      origin,
      destination,
      date,
      passengers = 1,
      budget = null,
      arrivalDeadline = null,
    } = searchParams;

    // Determine start point and preserved legs
    let startPoint = origin;
    let preservedLegs = [];

    if (this.lastConfirmedLocation && this.lastConfirmedLocation.toLowerCase() !== destination.toLowerCase()) {
      startPoint = this.lastConfirmedLocation;
      if (activeItinerary && activeItinerary.legs) {
        for (const leg of activeItinerary.legs) {
          if (leg.destination.toLowerCase() === this.lastConfirmedLocation.toLowerCase()) {
            preservedLegs.push(leg);
            break;
          }
        }
      }
    }

    // Filter services according to all disruption overlays
    const availableServices = allServices.map(svc => {
      const check = this.isServiceAffected(svc);
      if (check.affected) {
        return { ...svc, ...check.override, status: check.override.status || 'cancelled' };
      }
      return svc;
    });

    // Run route search using planner functions
    const { planJourney } = require('./planner');

    // Build constraints taking into account preserved legs (budget subtracted, arrival deadline enforced)
    const preservedCost = preservedLegs.reduce((sum, l) => sum + (l.fare_per_person || l.fare || 0), 0) * passengers;
    const remainingBudget = budget ? Math.max(0, budget - preservedCost) : null;

    const plannerResult = planJourney(availableServices, {
      origin: startPoint,
      destination,
      date,
      passengers,
      budget: remainingBudget,
      arrivalDeadline,
    }, this.getLegacyDisruptionState());

    // If we have preserved legs, merge them with the recovery options
    let recoveryOptions = plannerResult.options || [];

    if (preservedLegs.length > 0 && recoveryOptions.length > 0) {
      recoveryOptions = recoveryOptions.map((opt, idx) => {
        const mergedLegs = [...preservedLegs, ...opt.legs];
        const totalFarePerPerson = mergedLegs.reduce((s, l) => s + (l.fare_per_person || l.fare || 0), 0);
        const totalCostAll = totalFarePerPerson * passengers;
        const totalTransfers = mergedLegs.length - 1;

        // Total duration from first leg departure to final leg arrival
        const depTime = new Date(mergedLegs[0].departure);
        const arrTime = new Date(mergedLegs[mergedLegs.length - 1].arrival);
        const totalDurationMinutes = Math.round((arrTime.getTime() - depTime.getTime()) / 60000);

        return {
          ...opt,
          id: `recov-${idx + 1}`,
          tag: idx === 0 ? 'Best Recovery Route' : 'Alternative Recovery',
          legs: mergedLegs,
          summary: {
            ...opt.summary,
            transfers: totalTransfers,
            totalFarePerPerson,
            totalCostAllPassengers: totalCostAll,
            totalDurationMinutes,
            totalDurationFormatted: `${Math.floor(totalDurationMinutes / 60)}h ${totalDurationMinutes % 60}m`,
            departure: mergedLegs[0].departure,
            arrival: mergedLegs[mergedLegs.length - 1].arrival,
            recovered_from: startPoint,
            preserved_legs_count: preservedLegs.length,
          },
          explanation: `Adaptive recovery starting from ${startPoint}: preserves completed initial transit (${preservedLegs.map(l => l.service_id).join(',')}) and connects to ${destination}.`,
        };
      });
    }

    // Determine explanation
    let recoveryExplanation = '';
    if (recoveryOptions.length > 0) {
      const top = recoveryOptions[0];
      recoveryExplanation = `Found ${recoveryOptions.length} feasible adaptive recovery route(s) avoiding all active disruptions. Recommended option arrives at ${top.summary?.arrival?.substring(11, 16)} with ${top.summary?.transfers} transfer(s).`;
    } else {
      // Reason analysis
      const reasons = [];
      if (this.unavailableLocations.size > 0) {
        reasons.push(`Transfer station(s) ${Array.from(this.unavailableLocations).join(', ')} unavailable`);
      }
      if (this.closedSegments.size > 0) {
        reasons.push(`Route corridors ${Array.from(this.closedSegments).join(', ')} closed`);
      }
      if (plannerResult.no_route_explanation) {
        reasons.push(plannerResult.no_route_explanation);
      }
      recoveryExplanation = `No feasible recovery route found under current constraints. Reasons: ${reasons.join('; ')}.`;
    }

    return {
      success: true,
      found: recoveryOptions.length > 0,
      recovered_from: startPoint,
      preserved_legs: preservedLegs,
      options: recoveryOptions,
      explanation: recoveryExplanation,
      revision_suggestions: plannerResult.revision_suggestions || [
        'Consider increasing budget or relaxing arrival deadline',
        'Clear simulated disruptions to restore standard schedules',
      ],
      no_route_explanation: recoveryOptions.length === 0 ? recoveryExplanation : null,
      disclaimer: 'SIMULATED ADAPTIVE RECOVERY — Requires user approval to apply.',
    };
  }

  /**
   * Resolve / clear an individual disruption event.
   */
  resolve_disruption(eventId) {
    const event = this.events.get(eventId);
    if (!event) return { success: false, error: `Event ${eventId} not found` };

    event.status = 'resolved';

    // Clear associated service override if no other active event targets it
    if (event.target_service_id) {
      let otherActive = false;
      for (const e of this.events.values()) {
        if (e.status === 'active' && e.target_service_id === event.target_service_id) {
          otherActive = true;
          break;
        }
      }
      if (!otherActive) {
        this.serviceOverrides.delete(event.target_service_id);
      }
    }

    // Clear unavailable location if no other event targets it
    if (event.target_location) {
      let otherActive = false;
      for (const e of this.events.values()) {
        if (e.status === 'active' && e.target_location?.toLowerCase() === event.target_location.toLowerCase()) {
          otherActive = true;
          break;
        }
      }
      if (!otherActive) {
        this.unavailableLocations.delete(event.target_location.toLowerCase());
      }
    }

    // Clear closed segment if no other event targets it
    if (event.route_segment) {
      this.closedSegments.delete(event.route_segment.toLowerCase());
    }

    return {
      success: true,
      message: `Disruption ${eventId} resolved`,
      remaining_active: this.get_active_disruptions().length,
    };
  }
}

module.exports = {
  DisruptionEngine,
  MIN_TRANSFER_BUFFER_MINUTES,
};
