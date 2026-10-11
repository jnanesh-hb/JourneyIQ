// API helper — communicates with Express backend through /api (proxied via Vite)

const BASE = '/api';
const TIMEOUT_MS = 10000;

async function call(method, path, body = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
  };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(BASE + path, opts);
    clearTimeout(timeoutId);

    let data;
    try {
      data = await res.json();
    } catch {
      data = { error: `Server returned non-JSON response (HTTP ${res.status})` };
    }

    if (!res.ok) {
      // Create user-friendly error with structured diagnostics
      const err = new Error(
        data.error ||
        (data.errors && data.errors.join(', ')) ||
        `Technical error occurred (HTTP ${res.status})`
      );
      err.status = res.status;
      err.data = data;
      err.fieldErrors = data.fieldErrors || {};
      err.validationError = !!data.validation_error;
      err.technicalError = !!data.technical_error || res.status >= 500;
      err.diagnosticId = data.diagnostic_id || null;

      // Developer diagnostic logging (never directly thrown as raw stack to user)
      console.warn('[JourneyIQ API Diagnostic]', {
        method,
        path,
        status: res.status,
        data,
      });

      throw err;
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      console.error('[JourneyIQ API Timeout]', method, path);
      const timeoutErr = new Error('Request timed out. Planning service did not respond in time.');
      timeoutErr.technicalError = true;
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }

    if (!err.status) {
      // Network failure or backend offline
      console.error('[JourneyIQ Network/Fetch Error]', method, path, err);
      const netErr = new Error('Unable to connect to JourneyIQ backend service. Planning is temporarily unavailable.');
      netErr.technicalError = true;
      netErr.isNetworkError = true;
      throw netErr;
    }

    throw err;
  }
}

export const api = {
  health: () => call('GET', '/health'),
  cities: () => call('GET', '/cities'),
  services: () => call('GET', '/services'),
  disruptions: () => call('GET', '/disruptions'),

  parse: (text) => call('POST', '/parse', { text }),

  search: (params, simulateError = false) => {
    const query = simulateError ? '?simulate_error=true' : '';
    return call('POST', `/search${query}`, params);
  },

  disrupt: (service_id, type, delay_minutes, extra = {}) =>
    call('POST', '/disrupt', { service_id, type, delay_minutes, ...extra }),

  applyDisruption: (params) =>
    call('POST', '/disruptions/apply', params),

  clearDisruption: (service_id) => call('DELETE', `/disrupt/${service_id}`),
  resolveDisruption: (event_id) => call('DELETE', `/disruptions/${event_id}`),
  clearAllDisruptions: () => call('DELETE', '/disrupt'),
  resetDisruptions: () => call('POST', '/disruptions/reset'),

  checkDisruption: (itinerary) => call('POST', '/check-disruption', { itinerary }),
  evaluateDisruption: (itinerary) => call('POST', '/disruptions/evaluate', { itinerary }),

  confirm: (itinerary_id, itinerary, passengers) =>
    call('POST', '/confirm', { itinerary_id, itinerary, passengers }),

  approveRecovery: (itinerary, trip_id = 'default-trip', passengers = 1) =>
    call('POST', '/disruptions/approve', { itinerary, trip_id, passengers }),

  keepCurrentPlan: (trip_id = 'default-trip') =>
    call('POST', '/disruptions/keep-current', { trip_id }),

  agentChat: (session_id, message) =>
    call('POST', '/agent/chat', { session_id, message }),

  agentSession: (session_id) =>
    call('GET', `/agent/session/${session_id}`),

  tripStatus: (trip_id = 'default-trip') =>
    call('GET', `/trips/${trip_id}/status`),

  tripHistory: (trip_id = 'default-trip') =>
    call('GET', `/trips/${trip_id}/history`),

  tripReset: (trip_id = 'default-trip') =>
    call('POST', `/trips/${trip_id}/reset`),

  compareItineraries: (options) =>
    call('POST', '/itineraries/compare', { options }),

  recoverJourney: (params) =>
    call('POST', '/journeys/recover', params),
};
