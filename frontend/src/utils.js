// Utility helpers for formatting, icons, etc.

export function typeIcon(type) {
  if (!type) return '🚌';
  const t = type.toLowerCase();
  if (t === 'flight') return '✈️';
  if (t === 'train') return '🚆';
  if (t === 'bus') return '🚌';
  return '🚐';
}

export function formatTime(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { return isoStr; }
}

export function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return isoStr; }
}

export function formatDuration(minutes) {
  if (!minutes && minutes !== 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatINR(amount) {
  if (amount === null || amount === undefined) return '—';
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

export function statusLabel(status) {
  if (!status) return 'Unknown';
  return { on_time: 'On Time', delayed: 'Delayed', cancelled: 'Cancelled' }[status] || status;
}
