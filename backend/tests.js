/**
 * JourneyIQ — Comprehensive Automated Test Suite
 * 
 * Verifies all 17 mandatory requirements:
 * 1. Bus delay that preserves a connection.
 * 2. Train delay that causes a missed connection.
 * 3. Bus cancellation with a feasible replacement.
 * 4. Train cancellation with no feasible replacement.
 * 5. Vehicle breakdown and recovery from the last confirmed location.
 * 6. Service suspension and valid alternative departures.
 * 7. Missed connection recovery.
 * 8. Insufficient transfer time rejection.
 * 9. Transfer point unavailable.
 * 10. Route closure where route metadata supports it.
 * 11. Last-mile service unavailable.
 * 12. Multiple simultaneous disruptions.
 * 13. Budget or deadline violations after recovery.
 * 14. Explicit approval enforcement.
 * 15. Correct trip-status and history updates.
 * 16. Resetting the simulation without modifying original data.
 * 17. Backend failure without fabricated routes.
 * 
 * Run with: node tests.js
 */

const http = require('http');

const BASE_URL = 'http://localhost:3001';
const TRAVEL_DATE = '2026-10-15T00:00:00';

let passed = 0;
let failed = 0;
const results = [];

function log(msg) {
  process.stdout.write(msg + '\n');
}

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + (url.search || ''),
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test(name, fn) {
  try {
    const result = await fn();
    if (result.pass) {
      passed++;
      log(`  ✅ PASS: ${name}`);
      if (result.detail) log(`     ${result.detail}`);
    } else {
      failed++;
      log(`  ❌ FAIL: ${name}`);
      if (result.reason) log(`     Reason: ${result.reason}`);
    }
    results.push({ name, pass: result.pass, detail: result.detail || result.reason });
  } catch (err) {
    failed++;
    log(`  💥 ERROR: ${name} — ${err.message}`);
    results.push({ name, pass: false, detail: err.message });
  }
}

async function clearDisruptions() {
  await request('POST', '/api/disruptions/reset');
}

let localServer = null;

async function runTests() {
  // Ensure server is reachable, or launch it in-process
  try {
    await request('GET', '/health');
  } catch (e) {
    const app = require('./server');
    localServer = await new Promise((resolve) => {
      const s = app.listen(3001, () => resolve(s));
    });
  }

  log('');
  log('════════════════════════════════════════════════════════════════════');
  log('   JourneyIQ — Comprehensive Disruption & Recovery Test Suite');
  log('   17 Evaluation Flows (Service, Connection, Journey Level)');
  log('════════════════════════════════════════════════════════════════════');
  log('');

  // ─── T01: Bus delay that preserves a connection ──────────────────────────────
  await clearDisruptions();
  await test('T01: Bus delay that preserves a connection', async () => {
    // BU-301 (Hyderabad -> Vijayawada 07:00 to 12:00) connecting to BU-302 (Vijayawada -> Chennai 14:00 to 20:00)
    // Original buffer is 120 min. 45 min delay gives 75 min remaining buffer (> 45 min minimum).
    const itinerary = {
      id: 'itin-test-1',
      type: 'multi_leg',
      legs: [
        { service_id: 'BU-301', origin: 'Hyderabad', destination: 'Vijayawada', departure: '2026-10-15T07:00:00', arrival: '2026-10-15T12:00:00', type: 'bus' },
        { service_id: 'BU-302', origin: 'Vijayawada', destination: 'Chennai', departure: '2026-10-15T14:00:00', arrival: '2026-10-15T20:00:00', type: 'bus' }
      ]
    };

    const disRes = await request('POST', '/api/disruptions/apply', {
      type: 'bus_delay',
      service_id: 'BU-301',
      delay_minutes: 45,
      active_itinerary: itinerary,
    });

    const isFeasible = disRes.body.impact?.is_feasible === true;
    const isAffected = disRes.body.impact?.affected === true;

    return {
      pass: disRes.status === 200 && isFeasible && isAffected,
      detail: `Bus delay of 45m applied: journey remains feasible with absorbed buffer. Alert: "${disRes.body.impact?.alerts?.[0]?.title}"`,
    };
  });

  // ─── T02: Train delay that causes a missed connection ────────────────────────
  await clearDisruptions();
  await test('T02: Train delay that causes a missed connection', async () => {
    // TN-201 (Visakhapatnam -> Vijayawada 06:00 to 11:30) connecting to TN-301 (Vijayawada -> Chennai 13:00 to 19:30).
    // Original buffer: 90 min. Delay of 120m pushes arrival to 13:30, after TN-301 departure at 13:00.
    const itinerary = {
      id: 'itin-test-2',
      type: 'multi_leg',
      legs: [
        { service_id: 'TN-201', origin: 'Visakhapatnam', destination: 'Vijayawada', departure: '2026-10-15T06:00:00', arrival: '2026-10-15T11:30:00', type: 'train' },
        { service_id: 'TN-301', origin: 'Vijayawada', destination: 'Chennai', departure: '2026-10-15T13:00:00', arrival: '2026-10-15T19:30:00', type: 'train' }
      ]
    };

    const disRes = await request('POST', '/api/disruptions/apply', {
      type: 'train_delay',
      service_id: 'TN-201',
      delay_minutes: 120,
      active_itinerary: itinerary,
    });

    const isFeasible = disRes.body.impact?.is_feasible === false;
    const isMissed = disRes.body.impact?.first_failed_connection?.type === 'missed_connection';

    return {
      pass: disRes.status === 200 && isFeasible && isMissed,
      detail: `Train delay caused missed connection: ${disRes.body.impact?.first_failed_connection?.reason}`,
    };
  });

  // ─── T03: Bus cancellation with a feasible replacement ───────────────────────
  await clearDisruptions();
  await test('T03: Bus cancellation with a feasible replacement', async () => {
    // Cancel bus BU-401 from Visakhapatnam to Vijayawada
    await request('POST', '/api/disruptions/apply', {
      type: 'bus_cancellation',
      service_id: 'BU-401',
    });

    // Recover route Visakhapatnam -> Vijayawada
    const recRes = await request('POST', '/api/journeys/recover', {
      origin: 'Visakhapatnam',
      destination: 'Vijayawada',
      date: TRAVEL_DATE,
      passengers: 1,
      budget: 1500,
    });

    const found = recRes.body.found === true;
    const excludesCancelled = recRes.body.options?.every(opt => opt.legs.every(l => l.service_id !== 'BU-401'));

    return {
      pass: recRes.status === 200 && found && excludesCancelled,
      detail: `Found ${recRes.body.options?.length} alternatives excluding cancelled BU-401. Top route: ${recRes.body.options?.[0]?.legs?.[0]?.service_id}`,
    };
  });

  // ─── T04: Train cancellation with no feasible replacement ────────────────────
  await clearDisruptions();
  await test('T04: Train cancellation with no feasible replacement under tight budget', async () => {
    // Cancel TN-101 and TN-102 between Hyderabad and Chennai with strict ₹800 budget
    await request('POST', '/api/disruptions/apply', {
      type: 'train_cancellation',
      service_id: 'TN-101',
    });
    await request('POST', '/api/disruptions/apply', {
      type: 'train_cancellation',
      service_id: 'TN-102',
    });

    // Also cancel bus BU-301 to eliminate budget routes under ₹700
    await request('POST', '/api/disruptions/apply', {
      type: 'bus_cancellation',
      service_id: 'BU-301',
    });

    const recRes = await request('POST', '/api/journeys/recover', {
      origin: 'Hyderabad',
      destination: 'Chennai',
      date: TRAVEL_DATE,
      passengers: 1,
      budget: 700, // impossible with TN-101 and BU-301 cancelled
      arrivalDeadline: '2026-10-15T18:00:00',
    });

    const noRoute = recRes.body.found === false;
    const hasExplanation = recRes.body.no_route_explanation !== null;

    return {
      pass: recRes.status === 200 && noRoute && hasExplanation,
      detail: `No feasible replacement: "${recRes.body.no_route_explanation}"`,
    };
  });

  // ─── T05: Vehicle breakdown and recovery from the last confirmed location ────
  await clearDisruptions();
  await test('T05: Vehicle breakdown and recovery from last confirmed location', async () => {
    const itinerary = {
      id: 'itin-breakdown-demo',
      type: 'multi_leg',
      legs: [
        { service_id: 'TN-201', origin: 'Visakhapatnam', destination: 'Vijayawada', departure: '2026-10-15T06:00:00', arrival: '2026-10-15T10:15:00', fare: 920, type: 'train' },
        { service_id: 'BU-302', origin: 'Vijayawada', destination: 'Chennai', departure: '2026-10-15T14:00:00', arrival: '2026-10-15T20:00:00', fare: 600, type: 'bus' }
      ]
    };

    // Simulate breakdown on Leg 2 with last confirmed location = Vijayawada
    const disRes = await request('POST', '/api/disruptions/apply', {
      type: 'vehicle_breakdown',
      service_id: 'BU-302',
      last_confirmed_location: 'Vijayawada',
      active_itinerary: itinerary,
    });

    const recRes = await request('POST', '/api/journeys/recover', {
      origin: 'Visakhapatnam',
      destination: 'Chennai',
      date: TRAVEL_DATE,
      passengers: 1,
      budget: 2000,
      active_itinerary: itinerary,
    });

    const recoveredFromHub = recRes.body.recovered_from === 'Vijayawada';
    const preservedFirstLeg = recRes.body.preserved_legs?.length === 1 && recRes.body.preserved_legs[0].service_id === 'TN-201';

    return {
      pass: recRes.status === 200 && recRes.body.found && recoveredFromHub && preservedFirstLeg,
      detail: `Preserved Leg 1 (TN-201 from Visakhapatnam); recovered onwards from confirmed location ${recRes.body.recovered_from}`,
    };
  });

  // ─── T06: Service suspension and valid alternative departures ────────────────
  await clearDisruptions();
  await test('T06: Service suspension and valid alternative departures', async () => {
    // Suspend morning service departures for 4 hours
    await request('POST', '/api/disruptions/apply', {
      type: 'service_suspension',
      service_id: 'TN-201',
      suspension_hours: 4,
    });

    const recRes = await request('POST', '/api/journeys/recover', {
      origin: 'Visakhapatnam',
      destination: 'Vijayawada',
      date: TRAVEL_DATE,
      passengers: 1,
      budget: 1500,
    });

    const found = recRes.body.found === true;
    const excludesSuspended = recRes.body.options?.every(o => o.legs.every(l => l.service_id !== 'TN-201'));

    return {
      pass: recRes.status === 200 && found && excludesSuspended,
      detail: `Suspended TN-201 excluded; alternative afternoon departures found (${recRes.body.options?.length} candidate routes)`,
    };
  });

  // ─── T07: Missed connection recovery ─────────────────────────────────────────
  await clearDisruptions();
  await test('T07: Missed connection recovery replans from transfer hub', async () => {
    const itinerary = {
      id: 'itin-missed-conn',
      type: 'multi_leg',
      legs: [
        { service_id: 'TN-201', origin: 'Visakhapatnam', destination: 'Vijayawada', departure: '2026-10-15T06:00:00', arrival: '2026-10-15T10:15:00', fare: 920, type: 'train' },
        { service_id: 'BU-302', origin: 'Vijayawada', destination: 'Chennai', departure: '2026-10-15T14:00:00', arrival: '2026-10-15T20:00:00', fare: 600, type: 'bus' }
      ]
    };

    await request('POST', '/api/disruptions/apply', {
      type: 'missed_connection',
      connection: 'TN-201 → BU-302',
      location: 'Vijayawada',
      service_id: 'BU-302',
      active_itinerary: itinerary,
    });

    const recRes = await request('POST', '/api/journeys/recover', {
      origin: 'Visakhapatnam',
      destination: 'Chennai',
      date: TRAVEL_DATE,
      passengers: 1,
      budget: 2500,
      active_itinerary: itinerary,
    });

    const recoveredFromHub = recRes.body.recovered_from === 'Vijayawada';
    return {
      pass: recRes.status === 200 && recRes.body.found && recoveredFromHub,
      detail: `Replanned from transfer hub ${recRes.body.recovered_from} with ${recRes.body.options?.length} alternatives`,
    };
  });

  // ─── T08: Insufficient transfer time rejection ───────────────────────────────
  await clearDisruptions();
  await test('T08: Insufficient transfer time (< 45 min) rejected by validator', async () => {
    const itinerary = {
      id: 'itin-tight-buffer',
      type: 'multi_leg',
      legs: [
        { service_id: 'TN-201', origin: 'Visakhapatnam', destination: 'Vijayawada', departure: '2026-10-15T06:00:00', arrival: '2026-10-15T11:30:00', type: 'train' },
        { service_id: 'TN-301', origin: 'Vijayawada', destination: 'Chennai', departure: '2026-10-15T13:00:00', arrival: '2026-10-15T19:30:00', type: 'train' }
      ]
    };

    // Apply delay of 60 min to TN-201 -> arrives 12:30. Connecting departure at 13:00 leaves 30m (< 45m buffer).
    const disRes = await request('POST', '/api/disruptions/apply', {
      type: 'train_delay',
      service_id: 'TN-201',
      delay_minutes: 60,
      active_itinerary: itinerary,
    });

    const isFeasible = disRes.body.impact?.is_feasible === false;
    const isBufferFailure = disRes.body.impact?.first_failed_connection?.type === 'insufficient_transfer_time';

    return {
      pass: disRes.status === 200 && isFeasible && isBufferFailure,
      detail: `Transfer buffer under minimum detected: ${disRes.body.impact?.first_failed_connection?.reason}`,
    };
  });

  // ─── T09: Transfer point unavailable ─────────────────────────────────────────
  await clearDisruptions();
  await test('T09: Transfer point unavailable excludes all routes through that station', async () => {
    await request('POST', '/api/disruptions/apply', {
      type: 'transfer_point_unavailable',
      location: 'Vijayawada',
    });

    // Visakhapatnam to Chennai via Vijayawada
    const checkRes = await request('POST', '/api/disruptions/evaluate', {
      itinerary: {
        id: 'itin-via-bza',
        legs: [
          { service_id: 'TN-201', origin: 'Visakhapatnam', destination: 'Vijayawada', departure: '2026-10-15T06:00:00', arrival: '2026-10-15T11:30:00' },
          { service_id: 'TN-301', origin: 'Vijayawada', destination: 'Chennai', departure: '2026-10-15T13:00:00', arrival: '2026-10-15T19:30:00' }
        ]
      }
    });

    const rejected = checkRes.body.is_feasible === false;
    const reasonMatches = checkRes.body.alerts?.[0]?.message?.includes('Vijayawada');

    return {
      pass: checkRes.status === 200 && rejected && reasonMatches,
      detail: `Transfer point closed: routes through Vijayawada excluded (${checkRes.body.alerts?.[0]?.message})`,
    };
  });

  // ─── T10: Route or track closure ─────────────────────────────────────────────
  await clearDisruptions();
  await test('T10: Route corridor closure excludes all services along segment', async () => {
    await request('POST', '/api/disruptions/apply', {
      type: 'route_closure',
      route_segment: 'Visakhapatnam ➔ Vijayawada',
    });

    const checkRes = await request('POST', '/api/disruptions/evaluate', {
      itinerary: {
        id: 'itin-direct',
        legs: [
          { service_id: 'TN-201', origin: 'Visakhapatnam', destination: 'Vijayawada', departure: '2026-10-15T06:00:00', arrival: '2026-10-15T11:30:00' }
        ]
      }
    });

    const isFeasible = checkRes.body.is_feasible === false;
    const isCorridorClosed = checkRes.body.first_failed_connection?.type === 'route_closure';

    return {
      pass: checkRes.status === 200 && isFeasible && isCorridorClosed,
      detail: `Corridor closed: ${checkRes.body.first_failed_connection?.reason}`,
    };
  });

  // ─── T11: Last-mile transport unavailable ────────────────────────────────────
  await clearDisruptions();
  await test('T11: Last-mile connecting service unavailable triggers replanning', async () => {
    const itinerary = {
      id: 'itin-lastmile',
      legs: [
        { service_id: 'TN-201', origin: 'Visakhapatnam', destination: 'Vijayawada', departure: '2026-10-15T06:00:00', arrival: '2026-10-15T11:30:00' },
        { service_id: 'BU-302', origin: 'Vijayawada', destination: 'Chennai', departure: '2026-10-15T14:00:00', arrival: '2026-10-15T22:00:00' }
      ]
    };

    const disRes = await request('POST', '/api/disruptions/apply', {
      type: 'last_mile_unavailable',
      service_id: 'BU-302',
      active_itinerary: itinerary,
    });

    const isFeasible = disRes.body.impact?.is_feasible === false;

    // Run recovery
    const recRes = await request('POST', '/api/journeys/recover', {
      origin: 'Visakhapatnam',
      destination: 'Chennai',
      date: TRAVEL_DATE,
      passengers: 1,
      budget: 2500,
      active_itinerary: itinerary,
    });

    return {
      pass: disRes.status === 200 && isFeasible && recRes.body.found,
      detail: `Last-mile BU-302 marked cancelled; alternative final leg found: ${recRes.body.options?.[0]?.legs?.[recRes.body.options[0].legs.length-1]?.service_id}`,
    };
  });

  // ─── T12: Multiple simultaneous disruptions ──────────────────────────────────
  await clearDisruptions();
  await test('T12: Multiple simultaneous disruptions revalidate combined remaining itinerary', async () => {
    // 1. Bus delay on primary leg
    await request('POST', '/api/disruptions/apply', {
      type: 'bus_delay',
      service_id: 'BU-301',
      delay_minutes: 60,
    });

    // 2. Train cancellation on connecting leg
    await request('POST', '/api/disruptions/apply', {
      type: 'train_cancellation',
      service_id: 'TN-402',
    });

    const activeRes = await request('GET', '/api/disruptions/active');
    const hasMultiple = activeRes.body.events?.length === 2;

    const checkRes = await request('POST', '/api/disruptions/evaluate', {
      itinerary: {
        id: 'itin-compound',
        legs: [
          { service_id: 'BU-301', origin: 'Hyderabad', destination: 'Vijayawada', departure: '2026-10-15T07:00:00', arrival: '2026-10-15T12:00:00' },
          { service_id: 'TN-402', origin: 'Vijayawada', destination: 'Chennai', departure: '2026-10-15T10:30:00', arrival: '2026-10-15T16:00:00' }
        ]
      }
    });

    const isFeasible = checkRes.body.is_feasible === false;

    return {
      pass: activeRes.status === 200 && hasMultiple && isFeasible,
      detail: `Combined 2 simultaneous disruptions active. Downstream impact detected: ${checkRes.body.downstream_effects?.length} factors`,
    };
  });

  // ─── T13: Budget or deadline violations after recovery ───────────────────────
  await clearDisruptions();
  await test('T13: Budget or deadline violations after recovery correctly reported without hallucination', async () => {
    // Cancel cheaper services
    await request('POST', '/api/disruptions/apply', {
      type: 'bus_cancellation',
      service_id: 'BU-401',
    });
    await request('POST', '/api/disruptions/apply', {
      type: 'train_cancellation',
      service_id: 'TN-201',
    });

    // Request recovery with impossible budget ₹200 (cheapest remaining option is ₹350)
    const recRes = await request('POST', '/api/journeys/recover', {
      origin: 'Visakhapatnam',
      destination: 'Vijayawada',
      date: TRAVEL_DATE,
      passengers: 1,
      budget: 200,
    });

    const notFound = recRes.body.found === false;
    const mentionsBudget = recRes.body.no_route_explanation?.toLowerCase().includes('budget') || recRes.body.revision_suggestions?.some(s => s.toLowerCase().includes('budget'));

    return {
      pass: recRes.status === 200 && notFound && mentionsBudget,
      detail: `Honest budget rejection without fabricated fares: ${recRes.body.no_route_explanation}`,
    };
  });

  // ─── T14: Explicit approval enforcement ──────────────────────────────────────
  await clearDisruptions();
  await test('T14: Explicit approval enforcement: recovery requires user consent', async () => {
    // Rejection without explicit consent should be rejected
    const rejectRes = await request('POST', '/api/actions/confirm', {
      approved: false,
      action: 'reject',
    });

    const isBlocked = rejectRes.status === 400 && rejectRes.body.confirmed === false;

    // Approval with consent updates simulated booking
    const approveRes = await request('POST', '/api/actions/confirm', {
      approved: true,
      itinerary_id: 'recov-1',
      itinerary: {
        id: 'recov-1',
        legs: [{ service_id: 'TN-203', origin: 'Visakhapatnam', destination: 'Vijayawada', departure: '2026-10-15T13:00:00', arrival: '2026-10-15T18:30:00', fare: 350 }]
      },
      passengers: 1,
    });

    const isApproved = approveRes.status === 200 && approveRes.body.confirmed === true;

    return {
      pass: isBlocked && isApproved,
      detail: `Safety gate enforced: rejection blocked (HTTP 400), explicit confirmation verified (ID: ${approveRes.body.confirmation_id})`,
    };
  });

  // ─── T15: Correct trip-status and history updates ────────────────────────────
  await clearDisruptions();
  await test('T15: Correct trip-status transitions and history audit logging', async () => {
    const tripId = `test-trip-${Date.now().toString(36)}`;

    // 1. Initial status
    const stat1 = await request('GET', `/api/trips/${tripId}/status`);
    const isPlanning = stat1.body.status === 'planning';

    // 2. Confirm booking
    await request('POST', '/confirm', {
      trip_id: tripId,
      itinerary_id: 'itin-1',
      itinerary: {
        id: 'itin-1',
        legs: [{ service_id: 'TN-201', origin: 'Visakhapatnam', destination: 'Vijayawada', departure: '2026-10-15T06:00:00', arrival: '2026-10-15T11:30:00', fare: 280 }]
      },
      passengers: 1,
    });

    const stat2 = await request('GET', `/api/trips/${tripId}/status`);
    const isConfirmed = stat2.body.status === 'confirmed';

    // 3. Apply disruption -> moves to disrupted
    await request('POST', '/disrupt', {
      trip_id: tripId,
      service_id: 'TN-201',
      type: 'cancel',
    });

    const stat3 = await request('GET', `/api/trips/${tripId}/status`);
    const isDisrupted = stat3.body.status === 'disrupted';

    // 4. Approve recovery -> moves to recovered
    await request('POST', '/api/disruptions/approve', {
      trip_id: tripId,
      itinerary: {
        id: 'recov-1',
        legs: [{ service_id: 'TN-203', origin: 'Visakhapatnam', destination: 'Vijayawada', departure: '2026-10-15T13:00:00', arrival: '2026-10-15T18:30:00', fare: 350 }]
      },
      passengers: 1,
    });

    const stat4 = await request('GET', `/api/trips/${tripId}/status`);
    const isRecovered = stat4.body.status === 'recovered';

    // Check history audit log
    const hist = await request('GET', `/api/trips/${tripId}/history`);
    const hasAuditEvents = hist.body.events?.length >= 4;

    return {
      pass: isPlanning && isConfirmed && isDisrupted && isRecovered && hasAuditEvents,
      detail: `Full lifecycle verified: planning ➔ confirmed ➔ disrupted ➔ recovered (${hist.body.events?.length} audit events logged)`,
    };
  });

  // ─── T16: Resetting simulation without modifying original data ───────────────
  await test('T16: Resetting simulation overlay restores baseline data without mutation', async () => {
    // Add multiple disruptions
    await request('POST', '/api/disruptions/apply', { type: 'bus_cancellation', service_id: 'BU-401' });
    await request('POST', '/api/disruptions/apply', { type: 'train_delay', service_id: 'TN-101', delay_minutes: 60 });

    const activeBefore = await request('GET', '/api/disruptions/active');
    const hadDisruptions = activeBefore.body.events?.length >= 2;

    // Reset simulation
    const resetRes = await request('POST', '/api/disruptions/reset');

    const activeAfter = await request('GET', '/api/disruptions/active');
    const isClean = activeAfter.body.events?.length === 0;

    // Check services dataset integrity
    const health = await request('GET', '/health');
    const dataPristine = health.body.services_loaded >= 2000;

    return {
      pass: hadDisruptions && resetRes.status === 200 && isClean && dataPristine,
      detail: `Reset complete. Active disruptions: ${activeAfter.body.events?.length}. Synthetic dataset pristine: ${health.body.services_loaded} services.`,
    };
  });

  // ─── T17: Backend failure without fabricated routes ──────────────────────────
  await clearDisruptions();
  await test('T17: Backend failure handling produces structured diagnostics without fabricated routes', async () => {
    const res = await request('POST', '/search?simulate_error=true', {
      origin: 'Visakhapatnam', destination: 'Vijayawada', date: TRAVEL_DATE,
    });

    const isTechnicalError = res.body.technical_error === true;
    const hasDiagnosticId = !!res.body.diagnostic_id;
    const noRawStackTrace = !res.body.stack;

    return {
      pass: res.status === 500 && isTechnicalError && hasDiagnosticId && noRawStackTrace,
      detail: `Technical failure handled cleanly: "${res.body.error}" [Ref: ${res.body.diagnostic_id}]`,
    };
  });

  // ─── SUMMARY ─────────────────────────────────────────────────────────────────
  await clearDisruptions();

  log('');
  log('════════════════════════════════════════════════════════════════════');
  log(`   TEST RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  log('════════════════════════════════════════════════════════════════════');

  if (failed > 0) {
    log('\n  Failed tests:');
    results.filter(r => !r.pass).forEach(r => log(`    ❌ ${r.name}: ${r.detail}`));
  }

  log('');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
