import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { typeIcon, formatTime, formatDate, formatINR, formatDuration, statusLabel } from './utils';
import { AgentChat } from './AgentChat';

// Supported canonical demo locations (50 cities across India)
const SUPPORTED_CITIES = [
  'Agra', 'Ahmedabad', 'Ajmer', 'Allahabad', 'Amritsar',
  'Aurangabad', 'Bengaluru', 'Bhopal', 'Bhubaneswar', 'Chandigarh',
  'Chennai', 'Coimbatore', 'Cuttack', 'Delhi', 'Goa',
  'Guwahati', 'Hubli', 'Hyderabad', 'Imphal', 'Indore',
  'Jabalpur', 'Jaipur', 'Jodhpur', 'Kanpur', 'Kochi',
  'Kolkata', 'Kota', 'Lucknow', 'Ludhiana', 'Madurai',
  'Mangaluru', 'Mathura', 'Mumbai', 'Mysuru', 'Nagpur',
  'Patna', 'Pune', 'Raipur', 'Rajahmundry', 'Ranchi',
  'Shillong', 'Srinagar', 'Surat', 'Thiruvananthapuram', 'Tirupati',
  'Udaipur', 'Vadodara', 'Varanasi', 'Vijayawada', 'Visakhapatnam'
];

// ─── Sub-Components ────────────────────────────────────────────────────────────

function StatusBar({ disruptions }) {
  if (!disruptions || disruptions <= 0) return null;
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <div className="status-bar" id="status-disruption-indicator">
        <div className="status-dot amber" />
        <span>{disruptions} Disruption{disruptions > 1 ? 's' : ''} Active</span>
      </div>
    </div>
  );
}

function LegItem({ leg }) {
  return (
    <div className="leg-item">
      <span className="leg-type-icon">{typeIcon(leg.type)}</span>
      <div className="leg-details">
        <div className="leg-route-text">
          {leg.origin} → {leg.destination}
          <span className="badge badge-gray" style={{ marginLeft: 8 }}>{leg.service_id}</span>
        </div>
        <div className="leg-operator">{leg.operator} · {leg.class}</div>
        <div className="leg-times">
          <span className="leg-time">{formatTime(leg.departure)}</span>
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <span className="leg-time">{formatTime(leg.arrival)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <span className="leg-fare">{formatINR(leg.fare_per_person)}/pax</span>
        <span className={`leg-status status-${leg.status}`}>{statusLabel(leg.status)}</span>
        <span className="badge badge-gray">{leg.seats_available} seats</span>
      </div>
    </div>
  );
}

function ItineraryCard({ itinerary, index, isSelected, onSelect, passengers = 1 }) {
  const s = itinerary.summary;
  const isMulti = itinerary.type === 'multi_leg';

  return (
    <div
      id={`itinerary-card-${itinerary.id}`}
      className={`itinerary-card animate-in ${isSelected ? 'selected' : ''}`}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={() => onSelect(itinerary)}
    >
      <div className="itin-header">
        <div className="itin-route">
          <span className="itin-city">{itinerary.legs[0]?.origin}</span>
          <span className="itin-arrow">
            {isMulti ? `→ ${s.via} →` : '→'}
          </span>
          <span className="itin-city">{itinerary.legs[itinerary.legs.length - 1]?.destination}</span>
          <span className={`badge ${isMulti ? 'badge-purple' : 'badge-blue'}`}>
            {isMulti ? '1 Transfer' : 'Direct'}
          </span>
          {itinerary.tag && (
            <span className="badge badge-green">{itinerary.tag}</span>
          )}
        </div>

        <div className="itin-stats">
          <div className="itin-stat">
            <span className="itin-stat-value highlight">{formatINR(s.totalFarePerPerson)}</span>
            <span className="itin-stat-label">Per Person</span>
          </div>
          {passengers > 1 && (
            <div className="itin-stat">
              <span className="itin-stat-value">{formatINR(s.totalCostAllPassengers)}</span>
              <span className="itin-stat-label">Total ({passengers} pax)</span>
            </div>
          )}
          <div className="itin-stat">
            <span className="itin-stat-value">{s.totalDurationFormatted}</span>
            <span className="itin-stat-label">Duration</span>
          </div>
          <div className="itin-stat">
            <span className="itin-stat-value">{formatTime(s.arrival)}</span>
            <span className="itin-stat-label">Arrives</span>
          </div>
        </div>
      </div>

      {itinerary.explanation && (
        <div style={{ padding: '8px 20px', background: 'rgba(37, 99, 235, 0.08)', fontSize: 12, color: 'var(--accent-primary)', borderBottom: '1px solid var(--border)' }}>
          💡 {itinerary.explanation}
        </div>
      )}

      <div className="itin-legs">
        {itinerary.legs.map((leg, lidx) => (
          <React.Fragment key={leg.service_id}>
            <LegItem leg={leg} />
            {isMulti && lidx === 0 && (
              <div className="transfer-info">
                <span>⏱️ Transfer at {s.via}: {s.transferBufferMinutes} min buffer (minimum 45m safe window)</span>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Reliability & Risk Bar */}
      {itinerary.reliability_score && (
        <div style={{ padding: '8px 20px 12px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Reliability: <strong>{itinerary.reliability_score}%</strong></span>
            <span className={`badge ${itinerary.reliability_score >= 90 ? 'badge-green' : itinerary.reliability_score >= 75 ? 'badge-amber' : 'badge-red'}`}>
              {itinerary.risk_assessment?.level || 'Standard'}
            </span>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(itinerary);
            }}
          >
            {isSelected ? '✓ Selected' : 'Select for Review'}
          </button>
        </div>
      )}
    </div>
  );
}

function RejectedRoutes({ rejected }) {
  if (!rejected || rejected.length === 0) return null;
  return (
    <div className="rejected-routes-container" style={{ marginTop: 20 }}>
      <div className="section-title" style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Disqualified Options ({rejected.length} checked & rejected by constraints):
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rejected.map((item, idx) => (
          <div key={idx} className="rejected-card" style={{ background: 'var(--bg-elevated)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>🚫 {item.route}</div>
            <ul style={{ paddingLeft: 16, margin: '4px 0 0', color: 'var(--accent-amber)', fontSize: 11.5 }}>
              {item.reasons.map((r, ri) => <li key={ri}>{r}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfirmationBox({ confirmation, onReset }) {
  return (
    <div className="confirmation-box animate-in" id="confirmation-result-box" style={{ background: 'rgba(21, 128, 61, 0.08)', border: '1px solid rgba(21, 128, 61, 0.2)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
      <div style={{ fontSize: 42 }}>✅</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 8, color: 'var(--accent-green)' }}>
        Journey Confirmed
      </div>
      <div className="confirmation-id" style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-mono)', margin: '8px 0', letterSpacing: 1 }}>
        {confirmation.confirmation_id}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
        {confirmation.legs?.map(l => (
          <div key={l.service_id}>
            {l.service_id}: {l.origin} → {l.destination} · {formatTime(l.departure)} → {formatTime(l.arrival)}
          </div>
        ))}
      </div>
      <div className="simulation-warning" style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 8, fontSize: 11, textAlign: 'left', color: 'var(--text-muted)' }}>
        <div style={{ fontWeight: 700, color: 'var(--accent-amber)', marginBottom: 4 }}>ℹ️ Important Notes:</div>
        <ul style={{ paddingLeft: 16 }}>
          {confirmation.important_disclaimer?.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      </div>
      <button className="btn btn-secondary btn-sm" style={{ marginTop: 14 }} onClick={onReset}>
        ← Back to Planning Workspace
      </button>
    </div>
  );
}

// ─── Disruption Alert Component ────────────────────────────────────────────────
function DisruptionAlertBanner({ alert, onRecover, recovering }) {
  if (!alert) return null;

  const typeConfig = {
    bus_delay: { icon: '⏱️', badge: 'badge-amber', label: 'BUS DELAY' },
    train_delay: { icon: '⏱️', badge: 'badge-amber', label: 'TRAIN DELAY' },
    bus_cancellation: { icon: '❌', badge: 'badge-red', label: 'BUS CANCELLED' },
    train_cancellation: { icon: '❌', badge: 'badge-red', label: 'TRAIN CANCELLED' },
    vehicle_breakdown: { icon: '🚨', badge: 'badge-red', label: 'VEHICLE BREAKDOWN' },
    service_suspension: { icon: '⛔', badge: 'badge-purple', label: 'SERVICE SUSPENDED' },
    missed_connection: { icon: '⚠️', badge: 'badge-amber', label: 'MISSED CONNECTION' },
    insufficient_transfer_time: { icon: '⏳', badge: 'badge-amber', label: 'INSUFFICIENT BUFFER' },
    transfer_point_unavailable: { icon: '🚫', badge: 'badge-red', label: 'TRANSFER STATION CLOSED' },
    route_closure: { icon: '🚧', badge: 'badge-red', label: 'CORRIDOR CLOSED' },
    last_mile_unavailable: { icon: '🚌', badge: 'badge-red', label: 'LAST-MILE UNAVAILABLE' },
    multiple_disruptions: { icon: '💥', badge: 'badge-red', label: 'MULTIPLE DISRUPTIONS' },
    delay_absorbed: { icon: '⏱️', badge: 'badge-amber', label: 'DELAY ABSORBED' },
    disruption_detected: { icon: '⚠️', badge: 'badge-red', label: 'DISRUPTION DETECTED' },
  };

  const cfg = typeConfig[alert.type] || { icon: '⚠️', badge: 'badge-red', label: 'DISRUPTION DETECTED' };

  return (
    <div className={`disruption-alert-card ${alert.alert_level === 'critical' ? 'critical' : 'warning'}`} id="disruption-alert-banner">
      <div className="alert-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 20 }}>{cfg.icon}</span>
          <span className={`badge ${cfg.badge}`}>{cfg.label}</span>
          <span className="badge badge-gray">{alert.simulated_data_label || 'SIMULATED DATA'}</span>
        </div>
        {alert.recovery_available && onRecover && (
          <button
            className="btn btn-primary btn-sm"
            onClick={onRecover}
            disabled={recovering}
          >
            {recovering ? 'Replanning...' : '🔄 Recover Journey'}
          </button>
        )}
      </div>

      <div className="alert-title">{alert.title}</div>
      <div className="alert-message">{alert.message}</div>

      {alert.first_failed_connection && (
        <div className="alert-detail-item">
          <strong>First Failed Connection / Service:</strong>{' '}
          {typeof alert.first_failed_connection === 'object'
            ? alert.first_failed_connection.connection || alert.first_failed_connection.service_id || alert.first_failed_connection.reason || JSON.stringify(alert.first_failed_connection)
            : alert.first_failed_connection}
        </div>
      )}

      {alert.downstream_effects && alert.downstream_effects.length > 0 && (
        <div className="alert-downstream">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Impact on Downstream Journey:</div>
          <ul>
            {alert.downstream_effects.map((eff, i) => (
              <li key={i}>{eff}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Recovery Options Component ────────────────────────────────────────────────
function RecoveryOptionsCard({ recoveryResult, onApprove, onKeepCurrent, onSelectOption, selectedOptionId, confirming }) {
  if (!recoveryResult) return null;

  const { options, preserved_legs, recovered_from, found, explanation, revision_suggestions } = recoveryResult;

  if (!found || !options || options.length === 0) {
    return (
      <div className="recovery-no-route-card" id="recovery-no-route-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 24 }}>🚫</span>
          <div style={{ fontWeight: 700, fontSize: 16 }}>No Feasible Recovery Route Found</div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {explanation || 'All candidate paths through the synthetic transport network are blocked by active disruptions or violate your budget/deadline constraints.'}
        </p>

        {revision_suggestions && revision_suggestions.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-accent)' }}>Recommended Actions:</div>
            <ul style={{ margin: '6px 0', paddingLeft: 20, fontSize: 12 }}>
              {revision_suggestions.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" onClick={onKeepCurrent}>
            🛡️ Keep Current Plan & Close
          </button>
        </div>
      </div>
    );
  }

  const selectedOpt = options.find(o => o.id === selectedOptionId) || options[0];

  return (
    <div className="recovery-options-container" id="recovery-options-panel">
      <div className="recovery-header">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>🔄 Adaptive Journey Recovery</span>
            <span className="badge badge-green">{options.length} Candidate(s) Found</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {recovered_from ? `Replanned from verified reachable location: ${recovered_from}` : 'Replanned complete route'}
            {preserved_legs?.length > 0 ? ` (${preserved_legs.length} completed leg(s) preserved)` : ''}
          </p>
        </div>
      </div>

      <div className="recovery-explanation-box">
        💡 {explanation}
      </div>

      {/* Option selector pills if multiple candidates */}
      {options.length > 1 && (
        <div style={{ display: 'flex', gap: 8, margin: '12px 0', overflowX: 'auto', paddingBottom: 4 }}>
          {options.map((opt, idx) => (
            <button
              key={opt.id}
              className={`btn btn-sm ${selectedOpt.id === opt.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onSelectOption(opt.id)}
            >
              Option {idx + 1}: {opt.tag || opt.id} ({formatINR(opt.summary?.totalFarePerPerson)})
            </button>
          ))}
        </div>
      )}

      {/* Selected Option Card */}
      <div className="recovery-option-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span className="badge badge-blue">{selectedOpt.tag || 'Recommended Recovery'}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {selectedOpt.summary?.transfers === 0 ? 'Direct Route' : `${selectedOpt.summary?.transfers} Transfer(s)`}
          </span>
        </div>

        {/* Legs breakdown */}
        <div className="recovery-legs-list">
          {selectedOpt.legs.map((leg, lidx) => (
            <div key={leg.service_id || lidx} className="recovery-leg-item">
              <span style={{ fontSize: 18 }}>{typeIcon(leg.type)}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {leg.origin} → {leg.destination}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Service: <strong>{leg.service_id}</strong> ({leg.operator}) · Dep: {leg.departure?.substring(11, 16)} · Arr: {leg.arrival?.substring(11, 16)} · Fare: {formatINR(leg.fare_per_person || leg.fare)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary metrics */}
        <div className="recovery-metrics-grid">
          <div className="metric-box">
            <div className="metric-label">Total Duration</div>
            <div className="metric-val">{selectedOpt.summary?.totalDurationFormatted}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Total Cost</div>
            <div className="metric-val" style={{ color: 'var(--accent-green)' }}>
              {formatINR(selectedOpt.summary?.totalCostAllPassengers || selectedOpt.summary?.totalFarePerPerson)}
            </div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Final Arrival</div>
            <div className="metric-val">{selectedOpt.summary?.arrival?.substring(11, 16)}</div>
          </div>
        </div>

        {/* Human Approval Safety Gate Actions */}
        <div className="recovery-action-bar">
          <button
            id="approve-recovery-btn"
            className="btn btn-success"
            style={{ flex: 2 }}
            onClick={() => onApprove(selectedOpt)}
            disabled={confirming}
          >
            {confirming ? 'Updating Plan...' : '✓ Approve Simulated Change'}
          </button>
          <button
            id="keep-current-plan-btn"
            className="btn btn-secondary"
            style={{ flex: 1 }}
            onClick={onKeepCurrent}
          >
            Keep Current Plan
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Grouped Disruption Categories Definition ────────────────────────────────
const DISRUPTION_CATEGORIES = [
  {
    group: 'Transport-Service Disruptions',
    items: [
      { id: 'bus_delay', label: 'Bus delay', icon: '⏱️', desc: 'Apply delay to selected bus service' },
      { id: 'train_delay', label: 'Train delay', icon: '⏱️', desc: 'Apply delay to selected train service' },
      { id: 'bus_cancellation', label: 'Bus cancellation', icon: '❌', desc: 'Mark selected bus as cancelled' },
      { id: 'train_cancellation', label: 'Train cancellation', icon: '❌', desc: 'Mark selected train as cancelled' },
      { id: 'vehicle_breakdown', label: 'Vehicle breakdown', icon: '🚨', desc: 'Vehicle unusable mid-transit' },
      { id: 'service_suspension', label: 'Service suspension', icon: '⛔', desc: 'Suspend service for an operational window' },
    ]
  },
  {
    group: 'Connection Disruptions',
    items: [
      { id: 'missed_connection', label: 'Missed connection', icon: '⚠️', desc: 'Connecting service missed due to delay' },
      { id: 'insufficient_transfer_time', label: 'Insufficient transfer time', icon: '⏳', desc: 'Layover drops below 45m safe buffer' },
      { id: 'transfer_point_unavailable', label: 'Transfer point unavailable', icon: '🚫', desc: 'Interchange hub/station closed' },
    ]
  },
  {
    group: 'Journey-Level Disruptions',
    items: [
      { id: 'route_closure', label: 'Route or track closure', icon: '🚧', desc: 'Corridor or track segment closed' },
      { id: 'last_mile_unavailable', label: 'Last-mile transport unavailable', icon: '🚌', desc: 'Final connecting feeder service cancelled' },
      { id: 'multiple_disruptions', label: 'Multiple simultaneous disruptions', icon: '💥', desc: 'Combined multi-incident scenario' },
    ]
  }
];

// ─── Expanded Disruption Simulation Lab Panel ────────────────────────────────
function DisruptionPanel({
  services,
  activeItinerary,
  activeDisruptions,
  disruptionEvents,
  onApplyDisruption,
  onClearAll,
  onResolveEvent,
  onRecover,
  recovering,
  cities,
}) {
  const [selectedType, setSelectedType] = useState('bus_delay');
  const [selectedService, setSelectedService] = useState('');
  const [delayMinutes, setDelayMinutes] = useState(45);
  const [suspensionHours, setSuspensionHours] = useState(4);
  const [targetLocation, setTargetLocation] = useState('Vijayawada');
  const [routeSegment, setRouteSegment] = useState('Visakhapatnam ➔ Vijayawada');
  const [lastConfirmedLocation, setLastConfirmedLocation] = useState('Visakhapatnam');
  const [applying, setApplying] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Auto-select initial service from active itinerary if available
  useEffect(() => {
    if (activeItinerary?.legs?.length > 0) {
      const firstLeg = activeItinerary.legs[0];
      setSelectedService(firstLeg.service_id);
      setLastConfirmedLocation(firstLeg.origin);
      if (activeItinerary.summary?.via) {
        setTargetLocation(activeItinerary.summary.via);
      }
      setRouteSegment(`${firstLeg.origin} ➔ ${firstLeg.destination}`);
    } else if (services.length > 0 && !selectedService) {
      setSelectedService('TN-203');
    }
  }, [activeItinerary, services]);

  // Filter services by mode when delay or cancellation is selected
  const filteredServices = services.filter(s => {
    if (selectedType.startsWith('bus_')) return s.type === 'bus';
    if (selectedType.startsWith('train_')) return s.type === 'train';
    return true;
  });

  const handleApply = async () => {
    setApplying(true);
    setFeedback(null);
    try {
      const res = await onApplyDisruption({
        type: selectedType,
        service_id: selectedService || null,
        delay_minutes: delayMinutes,
        suspension_hours: suspensionHours,
        location: targetLocation,
        route_segment: routeSegment,
        last_confirmed_location: lastConfirmedLocation,
        itinerary_id: activeItinerary?.id || null,
      });
      setFeedback({ type: 'success', text: res.message || 'Simulated disruption applied successfully.' });
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Failed to simulate disruption.' });
    } finally {
      setApplying(false);
    }
  };

  // Find info about the currently selected service
  const currentServiceObj = services.find(s => s.id === selectedService);

  return (
    <div className="disruption-panel" id="disruption-control-panel">
      <div className="disruption-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>⚡ Comprehensive Disruption Simulation Lab</span>
        <span className="badge badge-amber">12 INCIDENT TYPES</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 16px' }}>
        Simulate travel incidents across transport services, transfers, and journey corridors to test how JourneyIQ revalidates feasibility and plans adaptive recoveries.
      </p>

      {/* Disruption Type Selector Grouped into 3 Categories */}
      <div style={{ marginBottom: 16 }}>
        {DISRUPTION_CATEGORIES.map(cat => (
          <div key={cat.group} className="disruption-category-group">
            <div className="disruption-category-title">{cat.group}</div>
            <div className="disruption-types-grid">
              {cat.items.map(item => (
                <div
                  key={item.id}
                  className={`disruption-type-card ${selectedType === item.id ? 'active' : ''}`}
                  onClick={() => setSelectedType(item.id)}
                >
                  <span style={{ fontSize: 16 }}>{item.icon}</span>
                  <div>
                    <div className="disruption-type-name">{item.label}</div>
                    <div className="disruption-type-desc">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Dynamic Controls based on selected disruption type */}
      <div className="card" style={{ padding: 16, marginBottom: 16, background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>⚙️ Configure Incident: <strong>{selectedType.replace(/_/g, ' ').toUpperCase()}</strong></span>
        </div>

        <div className="form-grid">
          {/* Target Service Selector (for service, breakdown, or last-mile disruptions) */}
          {(selectedType.includes('delay') || selectedType.includes('cancellation') || selectedType === 'vehicle_breakdown' || selectedType === 'service_suspension' || selectedType === 'last_mile_unavailable') && (
            <div className="form-group">
              <label className="form-label">Target Service</label>
              <select
                id="disrupt-service-select"
                className="form-select"
                value={selectedService}
                onChange={e => setSelectedService(e.target.value)}
              >
                <option value="">— Select Service —</option>
                {filteredServices.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.id} ({s.type?.toUpperCase()}) — {s.origin} → {s.destination} (Dep: {s.departure?.substring(11, 16)})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Delay Minutes input */}
          {selectedType.includes('delay') && (
            <div className="form-group">
              <label className="form-label">Delay Duration (Minutes)</label>
              <input
                type="number"
                className="form-input"
                value={delayMinutes}
                min={15}
                max={360}
                step={15}
                onChange={e => setDelayMinutes(Number(e.target.value))}
              />
            </div>
          )}

          {/* Suspension Window */}
          {selectedType === 'service_suspension' && (
            <div className="form-group">
              <label className="form-label">Suspension Window (Hours)</label>
              <select
                className="form-select"
                value={suspensionHours}
                onChange={e => setSuspensionHours(Number(e.target.value))}
              >
                <option value={2}>2 Hours Window</option>
                <option value={4}>4 Hours Window</option>
                <option value={8}>8 Hours Window</option>
                <option value={24}>24 Hours Full Day Suspension</option>
              </select>
            </div>
          )}

          {/* Confirmed Location (for breakdown or missed connection) */}
          {(selectedType === 'vehicle_breakdown' || selectedType === 'missed_connection') && (
            <div className="form-group">
              <label className="form-label">Last Confirmed Reachable Location</label>
              <select
                className="form-select"
                value={lastConfirmedLocation}
                onChange={e => setLastConfirmedLocation(e.target.value)}
              >
                {cities.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          {/* Transfer Station / Interchange */}
          {(selectedType === 'transfer_point_unavailable' || selectedType === 'insufficient_transfer_time' || selectedType === 'missed_connection') && (
            <div className="form-group">
              <label className="form-label">Transfer Interchange Hub</label>
              <select
                className="form-select"
                value={targetLocation}
                onChange={e => setTargetLocation(e.target.value)}
              >
                {cities.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          {/* Route Segment / Corridor */}
          {selectedType === 'route_closure' && (
            <div className="form-group">
              <label className="form-label">Closed Corridor (Origin ➔ Destination)</label>
              <input
                type="text"
                className="form-input"
                value={routeSegment}
                onChange={e => setRouteSegment(e.target.value)}
                placeholder="e.g. Visakhapatnam ➔ Vijayawada"
              />
            </div>
          )}
        </div>

        {/* Selected Service Context Card */}
        {currentServiceObj && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(59, 130, 246, 0.06)', borderRadius: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            Selected Service Context: <strong>{currentServiceObj.id}</strong> ({currentServiceObj.operator}) · {currentServiceObj.origin} → {currentServiceObj.destination} · Departure: {currentServiceObj.departure?.substring(11, 16)} · Fare: {formatINR(currentServiceObj.fare)}
          </div>
        )}

        {feedback && (
          <div className={`alert alert-${feedback.type === 'success' ? 'info' : 'error'}`} style={{ fontSize: 12, padding: 8, marginTop: 12 }}>
            {feedback.text}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button
            className="btn btn-amber"
            style={{ flex: 2 }}
            onClick={handleApply}
            disabled={applying}
          >
            {applying ? 'Simulating Incident...' : '⚡ Apply Simulated Disruption'}
          </button>

          {Object.keys(activeDisruptions).length > 0 && (
            <button
              id="clear-all-disruptions-btn"
              className="btn btn-secondary"
              onClick={onClearAll}
              style={{ flex: 1 }}
            >
              ✕ Reset Overlay
            </button>
          )}
        </div>

        {Object.keys(activeDisruptions).length > 0 && (
          <button
            id="replan-disruptions-btn"
            className="btn btn-primary btn-full"
            onClick={onRecover}
            disabled={recovering}
            style={{ marginTop: 10 }}
          >
            {recovering ? 'Replanning Adaptive Recovery...' : '🔄 Run Adaptive Recovery Replanner'}
          </button>
        )}
      </div>

      {/* Active Incidents Table */}
      {disruptionEvents && disruptionEvents.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className="section-title" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
            Active Simulation Overlay Incidents ({disruptionEvents.length}):
          </div>
          <div className="active-events-list">
            {disruptionEvents.map(ev => (
              <div key={ev.id} className="active-event-row">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-amber">{ev.type?.toUpperCase()}</span>
                    <strong style={{ fontSize: 12 }}>{ev.target_service_id || ev.target_location || ev.route_segment || ev.id}</strong>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    {ev.description}
                  </div>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => onResolveEvent(ev.id)}
                  title="Resolve this disruption"
                >
                  ✕ Clear
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main JourneyIQ Application ───────────────────────────────────────────────

export default function App() {
  // Connection and prototype data state
  const [backendOk, setBackendOk] = useState(false);
  const [services, setServices] = useState([]);
  const [activeDisruptions, setActiveDisruptions] = useState({});

  // Trip context constraints
  const [form, setForm] = useState({
    origin: 'Visakhapatnam',
    destination: 'Vijayawada',
    date: '2026-10-15',
    passengers: 1,
    budget: 1500,
    arrivalDeadline: '19:00',
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [validationAlert, setValidationAlert] = useState(null);

  // Search & Recovery State
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [technicalError, setTechnicalError] = useState(null);
  const [simulateBackendFailure, setSimulateBackendFailure] = useState(false);

  // Selection & Approval State
  const [selectedItinerary, setSelectedItinerary] = useState(null);
  const [showApproval, setShowApproval] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  // Disruption Overlay & Adaptive Recovery State
  const [disruptionEvents, setDisruptionEvents] = useState([]);
  const [disruptionAlert, setDisruptionAlert] = useState(null);
  const [recoveryResult, setRecoveryResult] = useState(null);
  const [selectedRecoveryOptionId, setSelectedRecoveryOptionId] = useState(null);
  const [recovering, setRecovering] = useState(false);

  // Central panel tab
  const [activeTab, setActiveTab] = useState('agent'); // 'agent' | 'compare' | 'schematic' | 'disrupt' | 'history'

  // Audit decision history
  const [tripHistory, setTripHistory] = useState([]);

  // External prompt trigger for agent chat
  const [externalPrompt, setExternalPrompt] = useState('');

  // Cities list (dynamically fetched from backend, falling back to SUPPORTED_CITIES)
  const [cities, setCities] = useState(SUPPORTED_CITIES);

  // ─── Initialization ─────────────────────────────────────────────────────────
  useEffect(() => {
    checkBackend();
    loadCities();
    loadServices();
    loadDisruptions();
    loadTripHistory();
  }, []);

  const loadCities = async () => {
    try {
      const data = await api.cities();
      if (data.cities && Array.isArray(data.cities) && data.cities.length > 0) {
        setCities([...data.cities].sort());
      }
    } catch { /* fallback to SUPPORTED_CITIES */ }
  };

  const checkBackend = async () => {
    try {
      await api.health();
      setBackendOk(true);
    } catch {
      setBackendOk(false);
    }
  };

  const loadServices = async () => {
    try {
      const data = await api.services();
      setServices(data.services || []);
    } catch { /* graceful fallback */ }
  };

  const loadDisruptions = async () => {
    try {
      const data = await api.disruptions();
      setActiveDisruptions(data.disruptions || {});
      setDisruptionEvents(data.events || []);
    } catch { /* graceful fallback */ }
  };

  const loadTripHistory = async () => {
    try {
      const data = await api.tripHistory('default-trip');
      setTripHistory(data.events || []);
    } catch { /* graceful fallback */ }
  };

  const setField = (field, value) => {
    setForm(f => ({ ...f, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const swapEndpoints = () => {
    setForm(f => ({ ...f, origin: f.destination, destination: f.origin }));
  };

  // ─── One-Click Hackathon Demo Scenarios ──────────────────────────────────────
  const runDemoScenario = (scenarioKey) => {
    if (scenarioKey === 'scenario-1-mandatory') {
      setForm({
        origin: 'Visakhapatnam',
        destination: 'Vijayawada',
        date: '2026-10-15',
        passengers: 1,
        budget: 1500,
        arrivalDeadline: '19:00',
      });
      setActiveTab('agent');
      setExternalPrompt('I need to travel from Visakhapatnam to Vijayawada tomorrow. My budget is ₹1,500, I need to arrive before 7 PM, and I prefer fewer transfers.');
    } else if (scenarioKey === 'scenario-2-disruption') {
      setActiveTab('agent');
      setExternalPrompt('Simulate delay on TN-203 by 30 minutes');
    } else if (scenarioKey === 'scenario-3-connecting') {
      setForm({
        origin: 'Hyderabad',
        destination: 'Chennai',
        date: '2026-10-15',
        passengers: 2,
        budget: 3000,
        arrivalDeadline: '18:00',
      });
      setActiveTab('compare');
      doSearch({
        origin: 'Hyderabad',
        destination: 'Chennai',
        date: '2026-10-15',
        passengers: 2,
        budget: 3000,
        arrivalDeadline: '18:00',
      });
    } else if (scenarioKey === 'scenario-4-failure') {
      setForm({
        origin: 'Visakhapatnam',
        destination: 'Vijayawada',
        date: '2026-10-15',
        passengers: 1,
        budget: 400, // strict impossible budget
        arrivalDeadline: '09:00', // impossible morning deadline
      });
      setActiveTab('compare');
      doSearch({
        origin: 'Visakhapatnam',
        destination: 'Vijayawada',
        date: '2026-10-15',
        passengers: 1,
        budget: 400,
        arrivalDeadline: '09:00',
      });
    }
  };

  // ─── Form Search Handler ────────────────────────────────────────────────────
  const doSearch = async (overrideForm = null) => {
    const f = overrideForm || form;
    setFieldErrors({});
    setValidationAlert(null);
    setTechnicalError(null);
    setSearching(true);
    setConfirmation(null);

    const fullDeadline = f.arrivalDeadline
      ? `${f.date}T${f.arrivalDeadline.length === 5 ? f.arrivalDeadline + ':00' : f.arrivalDeadline}`
      : null;

    try {
      const result = await api.search({
        origin: f.origin,
        destination: f.destination,
        date: `${f.date}T00:00:00`,
        passengers: f.passengers ? Number(f.passengers) : 1,
        budget: f.budget ? Number(f.budget) : null,
        arrivalDeadline: fullDeadline,
      }, simulateBackendFailure);

      setSearchResult(result);
      if (result.options && result.options.length > 0) {
        setSelectedItinerary(result.options[0]);
      } else {
        setSelectedItinerary(null);
      }
      await loadTripHistory();
    } catch (err) {
      if (err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        setFieldErrors(err.fieldErrors);
        setValidationAlert(err.message);
      } else {
        setTechnicalError({
          message: err.message || 'Planning service temporarily unavailable.',
          diagnosticId: err.diagnosticId || null,
        });
      }
    } finally {
      setSearching(false);
    }
  };

  // ─── Disruption Handlers ───────────────────────────────────────────────────
  const handleApplyDisruption = async (params) => {
    const res = await api.applyDisruption({
      ...params,
      trip_id: 'default-trip',
      active_itinerary: selectedItinerary,
    });
    await loadDisruptions();
    await loadServices();
    await loadTripHistory();

    if (res.impact?.alerts && res.impact.alerts.length > 0) {
      setDisruptionAlert(res.impact.alerts[0]);
    } else {
      setDisruptionAlert(null);
    }
    return res;
  };

  const handleResolveEvent = async (eventId) => {
    await api.resolveDisruption(eventId);
    await loadDisruptions();
    await loadServices();
    await loadTripHistory();
    if (selectedItinerary) {
      try {
        const check = await api.evaluateDisruption(selectedItinerary);
        setDisruptionAlert(check.alerts?.[0] || null);
      } catch {}
    }
  };

  const handleClearAllDisruptions = async () => {
    await api.resetDisruptions();
    await loadDisruptions();
    await loadServices();
    await loadTripHistory();
    setActiveDisruptions({});
    setDisruptionEvents([]);
    setDisruptionAlert(null);
    setRecoveryResult(null);
  };

  const handleRecoverJourney = async () => {
    setRecovering(true);
    try {
      const fullDeadline = form.arrivalDeadline
        ? `${form.date}T${form.arrivalDeadline.length === 5 ? form.arrivalDeadline + ':00' : form.arrivalDeadline}`
        : null;

      const res = await api.recoverJourney({
        origin: form.origin,
        destination: form.destination,
        date: `${form.date}T00:00:00`,
        passengers: Number(form.passengers) || 1,
        budget: form.budget ? Number(form.budget) : null,
        arrivalDeadline: fullDeadline,
        active_itinerary: selectedItinerary,
        trip_id: 'default-trip',
      });

      setRecoveryResult(res);
      if (res.options && res.options.length > 0) {
        setSelectedRecoveryOptionId(res.options[0].id);
      }
      await loadTripHistory();
    } catch (err) {
      alert(`Adaptive recovery encountered an error: ${err.message}`);
    } finally {
      setRecovering(false);
    }
  };

  const handleApproveRecovery = async (recoveryOpt) => {
    setConfirming(true);
    try {
      await api.approveRecovery(recoveryOpt, 'default-trip', Number(form.passengers));
      setSelectedItinerary(recoveryOpt);
      setRecoveryResult(null);
      setDisruptionAlert(null);
      await loadTripHistory();
    } catch (err) {
      alert(`Approval failed: ${err.message}`);
    } finally {
      setConfirming(false);
    }
  };

  const handleKeepCurrentPlanRecovery = async () => {
    await api.keepCurrentPlan('default-trip');
    setRecoveryResult(null);
    await loadTripHistory();
  };

  // ─── Agent Context Synchronization ──────────────────────────────────────────
  const handleSyncContextFromAgent = useCallback((syncData) => {
    if (syncData.context) {
      setForm(prev => ({
        ...prev,
        origin: syncData.context.origin || prev.origin,
        destination: syncData.context.destination || prev.destination,
        date: syncData.context.date ? syncData.context.date.split('T')[0] : prev.date,
        passengers: syncData.context.passengers || prev.passengers,
        budget: syncData.context.budget || prev.budget,
        arrivalDeadline: syncData.context.arrivalDeadline ? syncData.context.arrivalDeadline.split('T')[1]?.slice(0, 5) : prev.arrivalDeadline,
      }));
    }

    if (syncData.options && syncData.options.length > 0) {
      setSearchResult(prev => ({
        ...prev,
        found: true,
        options: syncData.options,
        search_meta: { candidates_generated: syncData.options.length },
      }));
      if (!selectedItinerary || !syncData.options.some(o => o.id === selectedItinerary.id)) {
        setSelectedItinerary(syncData.options[0]);
      }
    }

    if (syncData.disruptionState) {
      setActiveDisruptions(syncData.disruptionState);
    }

    if (syncData.selectedItinerary) {
      setSelectedItinerary(syncData.selectedItinerary);
      setShowApproval(true);
    }

    if (syncData.confirmation) {
      setConfirmation(syncData.confirmation);
      setShowApproval(false);
    }

    loadTripHistory();
  }, [selectedItinerary]);

  // ─── Approval & Confirmation ────────────────────────────────────────────────
  const handleSelectItinerary = (itin) => {
    setSelectedItinerary(itin);
    setShowApproval(true);
    setConfirmation(null);
  };

  const handleApproveSimulated = async () => {
    if (!selectedItinerary) return;
    setConfirming(true);
    try {
      const res = await api.confirm(selectedItinerary.id, selectedItinerary, Number(form.passengers));
      setConfirmation(res);
      setShowApproval(false);
      await loadTripHistory();
    } catch (err) {
      alert(`Confirmation failed: ${err.message}`);
    } finally {
      setConfirming(false);
    }
  };

  const handleKeepCurrentPlan = () => {
    setShowApproval(false);
  };

  const handleResetDemo = async () => {
    await handleClearAllDisruptions();
    await api.tripReset('default-trip');
    setSearchResult(null);
    setSelectedItinerary(null);
    setConfirmation(null);
    setShowApproval(false);
    await loadTripHistory();
  };

  // Check if current selected itinerary has an active disruption
  const isSelectedDisrupted = selectedItinerary?.legs?.some(l => activeDisruptions[l.service_id]);

  return (
    <div className="app">
      {/* Top Navigation */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <div className="logo-icon">🧭</div>
            <div>
              <div className="logo-text">JourneyIQ</div>
              <div className="logo-tagline">Intelligence for Every Connection</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <StatusBar disruptions={Object.keys(activeDisruptions).length} />

            <button className="btn btn-secondary btn-sm" onClick={handleResetDemo} title="Reset demo data and disruptions">
              🔄 Reset Demo
            </button>
          </div>
        </div>
      </header>

      {/* Main Rich 3-Column Workspace */}
      <div className="workspace-wrapper">
        <div className="workspace-3col">
          
          {/* ─── COLUMN 1: LEFT SIDEBAR (Trip Context & Constraints) ─── */}
          <aside className="left-sidebar-col">
            {/* Quick Demo Scenarios Card */}
            <div className="demo-scenarios-card">
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-accent)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                🎯 Quick Demo Scenarios
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 10px' }}>
                One-click demo flows to explore JourneyIQ features:
              </p>

              <button
                className="demo-scenario-btn"
                onClick={() => runDemoScenario('scenario-1-mandatory')}
              >
                <span className="demo-scenario-icon">🎯</span>
                <div>
                  <div className="demo-scenario-title">Scenario 1: Vizag → Vijayawada</div>
                  <div className="demo-scenario-desc">Vizag → Vijayawada, ₹1,500 budget, &lt; 7 PM arrival</div>
                </div>
              </button>

              <button
                className="demo-scenario-btn"
                onClick={() => runDemoScenario('scenario-2-disruption')}
              >
                <span className="demo-scenario-icon">⚡</span>
                <div>
                  <div className="demo-scenario-title">Scenario 2: Disruption on TN-203</div>
                  <div className="demo-scenario-desc">+30m delay breaches 7 PM ➔ Agent recovers with bus</div>
                </div>
              </button>

              <button
                className="demo-scenario-btn"
                onClick={() => runDemoScenario('scenario-3-connecting')}
              >
                <span className="demo-scenario-icon">🔄</span>
                <div>
                  <div className="demo-scenario-title">Scenario 3: Connecting Multimodal</div>
                  <div className="demo-scenario-desc">Hyd → Chennai via Vijayawada (90m transfer window)</div>
                </div>
              </button>

              <button
                className="demo-scenario-btn"
                onClick={() => runDemoScenario('scenario-4-failure')}
              >
                <span className="demo-scenario-icon">🚫</span>
                <div>
                  <div className="demo-scenario-title">Scenario 4: No-Route Failure State</div>
                  <div className="demo-scenario-desc">Impossible constraints ➔ Transparent attribution & advice</div>
                </div>
              </button>
            </div>

            {/* Travel Context Form Card */}
            <div className="card">
              <div className="card-header">
                <div className="card-icon blue">📍</div>
                <div>
                  <div className="card-title">Travel Requirements</div>
                  <div className="card-subtitle">Editable journey constraints</div>
                </div>
              </div>

              <div className="card-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Origin */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="origin-input">From (Origin)</label>
                    <select
                      id="origin-input"
                      className={`form-select ${fieldErrors.origin ? 'input-error' : ''}`}
                      value={form.origin}
                      onChange={e => setField('origin', e.target.value)}
                    >
                      <option value="">— Select Origin —</option>
                      {cities.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {fieldErrors.origin && <div className="field-error-msg" id="origin-error-msg">⚠️ {fieldErrors.origin}</div>}
                  </div>

                  {/* Swap Button */}
                  <div style={{ textAlign: 'center', margin: '-4px 0' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={swapEndpoints}
                      style={{ padding: '2px 10px', fontSize: 12 }}
                      title="Swap Origin and Destination"
                    >
                      ⇅ Swap
                    </button>
                  </div>

                  {/* Destination */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="destination-input">To (Destination)</label>
                    <select
                      id="destination-input"
                      className={`form-select ${fieldErrors.destination ? 'input-error' : ''}`}
                      value={form.destination}
                      onChange={e => setField('destination', e.target.value)}
                    >
                      <option value="">— Select Destination —</option>
                      {cities.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {fieldErrors.destination && <div className="field-error-msg" id="destination-error-msg">⚠️ {fieldErrors.destination}</div>}
                  </div>

                  {/* Date */}
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label className="form-label" htmlFor="travel-date-input">Travel Date</label>
                      <button
                        type="button"
                        onClick={() => setField('date', '2026-10-15')}
                        style={{ background: 'none', border: 'none', color: 'var(--text-accent)', fontSize: 11, cursor: 'pointer' }}
                      >
                        Demo: 2026-10-15
                      </button>
                    </div>
                    <input
                      id="travel-date-input"
                      type="date"
                      className={`form-input ${fieldErrors.date ? 'input-error' : ''}`}
                      value={form.date}
                      onChange={e => setField('date', e.target.value)}
                    />
                    {fieldErrors.date && <div className="field-error-msg" id="date-error-msg">⚠️ {fieldErrors.date}</div>}
                  </div>

                  {/* Passengers & Budget */}
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label" htmlFor="passengers-input">Pax (1-10)</label>
                      <input
                        id="passengers-input"
                        type="number"
                        min={1}
                        max={10}
                        className="form-input"
                        value={form.passengers}
                        onChange={e => setField('passengers', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="budget-input">Budget (₹)</label>
                      <input
                        id="budget-input"
                        type="number"
                        className="form-input"
                        placeholder="e.g. 1500"
                        value={form.budget}
                        onChange={e => setField('budget', e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Arrival Deadline */}
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label className="form-label" htmlFor="arrival-deadline-input">Arrival Deadline</label>
                      <button
                        type="button"
                        onClick={() => setField('arrivalDeadline', '19:00')}
                        style={{ background: 'none', border: 'none', color: 'var(--text-accent)', fontSize: 11, cursor: 'pointer' }}
                      >
                        7:00 PM
                      </button>
                    </div>
                    <input
                      id="arrival-deadline-input"
                      type="time"
                      className="form-input"
                      value={form.arrivalDeadline}
                      onChange={e => setField('arrivalDeadline', e.target.value)}
                    />
                  </div>

                  {/* Search Action */}
                  <button
                    id="search-journeys-btn"
                    className="btn btn-primary btn-full"
                    onClick={() => {
                      setActiveTab('compare');
                      doSearch();
                    }}
                    disabled={searching || !backendOk}
                    style={{ marginTop: 6 }}
                  >
                    {searching ? 'Evaluating Routes...' : '🔍 Search & Compare'}
                  </button>

                  {/* Backend Failure Simulation Tool */}
                  <label className="simulate-error-toggle" id="simulate-error-toggle-label" style={{ fontSize: 11, marginTop: 4 }}>
                    <input
                      type="checkbox"
                      id="simulate-error-checkbox"
                      checked={simulateBackendFailure}
                      onChange={e => setSimulateBackendFailure(e.target.checked)}
                    />
                    <span>Simulate Backend 500 Error (Verify Fault Tolerance)</span>
                  </label>
                </div>
              </div>
            </div>
          </aside>

          {/* ─── COLUMN 2: CENTRAL WORKSPACE (Agent & Tabs) ─── */}
          <main className="center-workspace-col" id="results-display-pane">
            {/* Tab Navigation */}
            <div className="tabs" style={{ maxWidth: '100%', margin: 0 }}>
              <button
                id="tab-agent-btn"
                className={`tab-btn ${activeTab === 'agent' ? 'active' : ''}`}
                onClick={() => setActiveTab('agent')}
              >
                🤖 Agent Concierge
              </button>
              <button
                id="tab-search-btn"
                className={`tab-btn ${activeTab === 'compare' ? 'active' : ''}`}
                onClick={() => setActiveTab('compare')}
              >
                📊 Compare Routes ({searchResult?.options?.length || 0})
              </button>
              <button
                id="tab-schematic-btn"
                className={`tab-btn ${activeTab === 'schematic' ? 'active' : ''}`}
                onClick={() => setActiveTab('schematic')}
              >
                🗺️ Route Map & Schematic
              </button>
              <button
                id="tab-disrupt-btn"
                className={`tab-btn ${activeTab === 'disrupt' ? 'active' : ''}`}
                onClick={() => setActiveTab('disrupt')}
              >
                ⚡ Disruption Lab {Object.keys(activeDisruptions).length > 0 && `(${Object.keys(activeDisruptions).length})`}
              </button>
              <button
                id="tab-history-btn"
                className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                📜 Decision Audit Log
              </button>
            </div>

            {/* TAB 1: AGENT CONCIERGE */}
            {activeTab === 'agent' && (
              <AgentChat
                onSyncContext={handleSyncContextFromAgent}
                onSelectItinerary={handleSelectItinerary}
                selectedItineraryId={selectedItinerary?.id}
                externalPrompt={externalPrompt}
              />
            )}

            {/* TAB 2: COMPARE ROUTES */}
            {activeTab === 'compare' && (
              <div>
                {searching && (
                  <div className="loading-state animate-in" id="loading-state-view">
                    <div className="loading-spinner" style={{ width: 40, height: 40, borderWidth: 3 }} />
                    <div style={{ fontWeight: 600, fontSize: 16 }}>Evaluating Candidate Routes & Transfer Feasibility…</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      Validating timestamps, transfer buffers (≥45m), budget thresholds, and Pareto dominance
                    </div>
                  </div>
                )}

                {technicalError && !searching && (
                  <div className="technical-error-card animate-in" id="technical-error-card">
                    <div className="technical-error-icon">⚠️</div>
                    <div className="technical-error-title">Planning Service Fault Detected</div>
                    <div className="technical-error-desc">
                      {technicalError.message}
                      <br /><br />
                      Your travel request parameters remain intact. You can safely retry without re-entering data.
                      {technicalError.diagnosticId && (
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                          Diagnostic Reference: <code>{technicalError.diagnosticId}</code>
                        </span>
                      )}
                    </div>
                    <div className="technical-error-actions">
                      <button id="retry-search-btn" className="btn btn-primary" onClick={() => doSearch()}>
                        🔄 Retry Search
                      </button>
                    </div>
                  </div>
                )}

                {/* Active Disruption Alert & Recovery Options */}
                {disruptionAlert && (
                  <DisruptionAlertBanner
                    alert={disruptionAlert}
                    onRecover={handleRecoverJourney}
                    recovering={recovering}
                  />
                )}

                {recoveryResult && (
                  <RecoveryOptionsCard
                    recoveryResult={recoveryResult}
                    onApprove={handleApproveRecovery}
                    onKeepCurrent={handleKeepCurrentPlanRecovery}
                    onSelectOption={setSelectedRecoveryOptionId}
                    selectedOptionId={selectedRecoveryOptionId}
                    confirming={confirming}
                  />
                )}

                {searchResult && !searching && !technicalError && (
                  <>
                    {searchResult.found ? (
                      <div>
                        <div className="section-header" id="feasible-itineraries-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                          <div className="section-title">
                            ✅ Feasible Multimodal Itineraries
                            <span className="section-count"> ({searchResult.options.length} verified)</span>
                          </div>
                          <span className="badge badge-blue">Pareto Optimal Front</span>
                        </div>

                        {searchResult.options.map((itin, idx) => (
                          <ItineraryCard
                            key={itin.id}
                            itinerary={itin}
                            index={idx}
                            isSelected={selectedItinerary?.id === itin.id}
                            onSelect={handleSelectItinerary}
                            passengers={Number(form.passengers)}
                          />
                        ))}

                        <RejectedRoutes rejected={searchResult.rejected_details} />
                      </div>
                    ) : searchResult.disruption_recovery_failed ? (
                      /* Disruption Recovery Failed Card */
                      <div className="recovery-failed-card animate-in" id="recovery-failed-card">
                        <div className="recovery-failed-header">
                          <div className="recovery-failed-icon">⚡</div>
                          <div>
                            <div className="recovery-failed-title">Disruption Recovery Failed</div>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                              Simulated disruption invalidated the original plan and no feasible alternative exists under current constraints.
                            </div>
                          </div>
                        </div>

                        <div className="disruption-cause-box" style={{ margin: '14px 0', background: 'rgba(245, 158, 11, 0.1)', padding: 12, borderRadius: 8 }}>
                          <strong style={{ color: 'var(--accent-amber)', fontSize: 12 }}>Incident Attribution:</strong>
                          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
                            {searchResult.disruption_causes?.map((c, i) => <li key={i}>{c.description}</li>)}
                          </ul>
                        </div>

                        <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                          {searchResult.no_route_explanation}
                        </p>

                        <div style={{ marginTop: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                            Recommended Next Steps:
                          </div>
                          <ul className="revision-suggestions-list">
                            {searchResult.revision_suggestions?.map((s, i) => (
                              <li key={i} className="revision-suggestion-item"><span>💡</span> {s}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : (
                      /* No Feasible Route Card */
                      <div className="no-route-box animate-in" id="no-feasible-route-card">
                        <div className="no-route-icon">🚫</div>
                        <div className="no-route-title">No Feasible Journey Found</div>
                        <div className="no-route-explanation">
                          {searchResult.no_route_explanation || 'No candidate routes satisfy all specified constraints.'}
                        </div>

                        {searchResult.revision_suggestions?.length > 0 && (
                          <div style={{ textAlign: 'left', margin: '16px auto 0', maxWidth: 460 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                              Recommended Adjustments:
                            </div>
                            <ul className="revision-suggestions-list">
                              {searchResult.revision_suggestions.map((s, i) => (
                                <li key={i} className="revision-suggestion-item"><span>💡</span> {s}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <RejectedRoutes rejected={searchResult.rejected_details} />
                      </div>
                    )}
                  </>
                )}

                {!searchResult && !searching && !technicalError && (
                  <div className="card" id="idle-welcome-card" style={{ padding: 40, textAlign: 'center' }}>
                    <div style={{ fontSize: 56, marginBottom: 16 }}>🗺️</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Ready to Compare Routes</div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 500, margin: '0 auto 20px', lineHeight: 1.6 }}>
                      Ask the agent in natural English or configure your requirements on the left, then click <strong>Search & Compare</strong> to generate verified multimodal routes.
                    </p>
                    <button className="btn btn-primary" onClick={() => runDemoScenario('scenario-1-mandatory')}>
                      🎯 Try Sample: Vizag → Vijayawada
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: ROUTE SCHEMATIC & MAP */}
            {activeTab === 'schematic' && (
              <div className="schematic-card">
                <div className="section-title">🗺️ Schematic Route & Transit Nodes</div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 16px' }}>
                  Visual schematic topology of stations, connections, transfer buffers, and real-time disruption status.
                </p>

                {selectedItinerary ? (
                  <div className="schematic-timeline">
                    {selectedItinerary.legs.map((leg, lidx) => {
                      const isDisrupted = !!activeDisruptions[leg.service_id];
                      return (
                        <div key={leg.service_id} className="schematic-node">
                          <div className={`schematic-point ${isDisrupted ? 'disrupted' : ''}`}>
                            {lidx + 1}
                          </div>
                          {lidx < selectedItinerary.legs.length - 1 && (
                            <div className={`schematic-connector ${isDisrupted ? 'disrupted' : ''}`} />
                          )}
                          <div className="schematic-content">
                            <div className="schematic-stop-title">
                              <span>{leg.origin} ➔ {leg.destination}</span>
                              <span className={`badge ${isDisrupted ? 'badge-red' : 'badge-green'}`}>
                                {isDisrupted ? 'DISRUPTED' : 'ON TIME'}
                              </span>
                            </div>
                            <div className="schematic-leg-details">
                              <span>Service: <strong>{leg.service_id}</strong> ({leg.operator})</span>
                              <span>Mode: <strong>{typeIcon(leg.type)} {leg.type?.toUpperCase()}</strong></span>
                              <span>Departs: <strong>{formatTime(leg.departure)}</strong></span>
                              <span>Arrives: <strong>{formatTime(leg.arrival)}</strong></span>
                              <span>Fare: <strong>{formatINR(leg.fare_per_person)}</strong></span>
                            </div>
                            {isDisrupted && (
                              <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(239,68,68,0.15)', borderRadius: 4, color: '#fca5a5', fontSize: 11.5 }}>
                                ⚠️ Disruption Override: {activeDisruptions[leg.service_id].status?.toUpperCase()}
                                {activeDisruptions[leg.service_id].delay_minutes ? ` (+${activeDisruptions[leg.service_id].delay_minutes}m delay)` : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                    No itinerary selected. Select a route card to view its schematic line.
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: DISRUPTION LAB */}
            {activeTab === 'disrupt' && (
              <div>
                {disruptionAlert && (
                  <DisruptionAlertBanner
                    alert={disruptionAlert}
                    onRecover={handleRecoverJourney}
                    recovering={recovering}
                  />
                )}

                {recoveryResult && (
                  <RecoveryOptionsCard
                    recoveryResult={recoveryResult}
                    onApprove={handleApproveRecovery}
                    onKeepCurrent={handleKeepCurrentPlanRecovery}
                    onSelectOption={setSelectedRecoveryOptionId}
                    selectedOptionId={selectedRecoveryOptionId}
                    confirming={confirming}
                  />
                )}

                <DisruptionPanel
                  services={services}
                  activeItinerary={selectedItinerary}
                  activeDisruptions={activeDisruptions}
                  disruptionEvents={disruptionEvents}
                  onApplyDisruption={handleApplyDisruption}
                  onClearAll={handleClearAllDisruptions}
                  onResolveEvent={handleResolveEvent}
                  onRecover={handleRecoverJourney}
                  recovering={recovering}
                  cities={cities}
                />
              </div>
            )}

            {/* TAB 5: DECISION AUDIT LOG */}
            {activeTab === 'history' && (
              <div className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="section-title">📜 Chronological Decision & Recovery Audit Log</div>
                  <span className="badge badge-purple">{tripHistory.length} Recorded Events</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 14px' }}>
                  Transparent audit log of agent tool invocations, route validations, simulated disruption incidents, and human approvals.
                </p>

                <div className="audit-timeline">
                  {tripHistory.map((item, idx) => (
                    <div key={item.id || idx} className="audit-entry">
                      <div className="audit-type-icon">
                        {item.type?.includes('BOOKING') ? '✅' : item.type?.includes('DISRUPTION') ? '⚡' : item.type?.includes('RECOVERY') ? '🔄' : '🔍'}
                      </div>
                      <div className="audit-body">
                        <div className="audit-header-row">
                          <span className="audit-type-tag" style={{ color: item.type?.includes('BOOKING') ? 'var(--accent-green)' : item.type?.includes('DISRUPTION') ? 'var(--accent-red)' : 'var(--text-accent)' }}>
                            {item.type}
                          </span>
                          <span className="audit-time">{item.timestamp?.substring(11, 19)}</span>
                        </div>
                        <div className="audit-summary">{item.summary}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </main>

          {/* ─── COLUMN 3: RIGHT PANEL (Active Status & Approval Gate) ─── */}
          <aside className="right-panel-col">
            {/* Active Journey Card */}
            <div className="card">
              <div className="card-header">
                <div className="card-icon green">🎫</div>
                <div>
                  <div className="card-title">Active Journey</div>
                  <div className="card-subtitle">
                    {confirmation ? 'Booking Status: Confirmed' : selectedItinerary ? 'Status: Pending Approval' : 'No Itinerary Selected'}
                  </div>
                </div>
              </div>

              <div className="card-body">
                {confirmation ? (
                  <ConfirmationBox
                    confirmation={confirmation}
                    onReset={() => {
                      setConfirmation(null);
                      setShowApproval(false);
                    }}
                  />
                ) : selectedItinerary ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span className="badge badge-blue">{selectedItinerary.id}</span>
                      <span className="badge badge-gray">{selectedItinerary.type === 'direct' ? 'Direct' : 'Connecting'}</span>
                    </div>

                    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                      {selectedItinerary.legs[0]?.origin} → {selectedItinerary.legs[selectedItinerary.legs.length - 1]?.destination}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, margin: '8px 0', color: 'var(--text-secondary)' }}>
                      <span>Departs: <strong>{formatTime(selectedItinerary.summary.departure)}</strong></span>
                      <span>Arrives: <strong>{formatTime(selectedItinerary.summary.arrival)}</strong></span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, margin: '8px 0', color: 'var(--text-secondary)' }}>
                      <span>Duration: <strong>{selectedItinerary.summary.totalDurationFormatted}</strong></span>
                      <span>Fare: <strong style={{ color: 'var(--accent-green)' }}>{formatINR(selectedItinerary.summary.totalCostAllPassengers)}</strong></span>
                    </div>

                    {/* Rich Disruption Alert & Recovery Options in Active Journey Card */}
                    {disruptionAlert && (
                      <div style={{ marginTop: 14 }}>
                        <DisruptionAlertBanner
                          alert={disruptionAlert}
                          onRecover={handleRecoverJourney}
                          recovering={recovering}
                        />
                      </div>
                    )}

                    {recoveryResult && (
                      <div style={{ marginTop: 14 }}>
                        <RecoveryOptionsCard
                          recoveryResult={recoveryResult}
                          onApprove={handleApproveRecovery}
                          onKeepCurrent={handleKeepCurrentPlanRecovery}
                          onSelectOption={setSelectedRecoveryOptionId}
                          selectedOptionId={selectedRecoveryOptionId}
                          confirming={confirming}
                        />
                      </div>
                    )}

                    {isSelectedDisrupted && !disruptionAlert && (
                      <div className="alert alert-error" id="active-disruption-banner" style={{ marginTop: 12, padding: 10 }}>
                        <div style={{ fontWeight: 700 }}>⚡ Active Disruption Notice</div>
                        <div style={{ fontSize: 11.5, marginTop: 2 }}>
                          One or more services on this journey have simulated disruptions. Re-evaluate remaining connections using adaptive recovery.
                        </div>
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ marginTop: 8 }}
                          onClick={handleRecoverJourney}
                          disabled={recovering}
                        >
                          {recovering ? 'Replanning...' : '🔄 Recover Journey'}
                        </button>
                      </div>
                    )}

                    {/* Approval Safety Gate */}
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-amber)', textTransform: 'uppercase', marginBottom: 6 }}>
                        🔒 Human Approval Safety Boundary:
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 12 }}>
                        Consequential changes require explicit traveller choice. No real-world booking or financial transaction occurs.
                      </p>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <button
                          id="confirm-simulated-booking-btn"
                          className="btn btn-success btn-full"
                          onClick={handleApproveSimulated}
                          disabled={confirming}
                        >
                          {confirming ? 'Confirming...' : '✓ Approve Simulated Change'}
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={handleKeepCurrentPlan}
                          disabled={confirming}
                        >
                          Keep Current Plan
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                    <div style={{ fontSize: 13 }}>Select any itinerary to inspect details and open the human approval gate.</div>
                  </div>
                )}
              </div>
            </div>

            {/* How It Works Notice */}
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                ℹ️ How JourneyIQ Works
              </div>
              All timetables, fares, and delays are computed by deterministic route-planning algorithms. The AI agent orchestrates search, validation, disruption recovery, and itinerary ranking transparently.
            </div>
          </aside>

        </div>
      </div>

      {/* Footer */}
      <footer className="footer" style={{ borderTop: '1px solid var(--border)', padding: '20px 24px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
        <div>JourneyIQ · Intelligence for Every Connection</div>
        <div style={{ marginTop: 4 }}>
          Powered by deterministic route-planning &amp; AI-assisted disruption recovery.
        </div>
      </footer>
    </div>
  );
}
