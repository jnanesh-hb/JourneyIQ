import React, { useState, useEffect, useRef } from 'react';
import { api } from './api';

export function AgentChat({
  onSyncContext,
  onSelectItinerary,
  selectedItineraryId,
  externalPrompt,
}) {
  const [sessionId] = useState(() => `session-${Math.random().toString(36).substring(2, 9)}`);
  const [messages, setMessages] = useState([
    {
      sender: 'agent',
      text: "👋 Welcome to **JourneyIQ**! I'm your multimodal travel concierge agent with adaptive journey recovery. Tell me where you need to travel, or select one of the hackathon demo prompts below.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionInfo, setSessionInfo] = useState({ state: 'idle', context: {} });
  const [error, setError] = useState(null);
  const chatEndRef = useRef(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // Handle external prompts triggered from left sidebar demo buttons
  useEffect(() => {
    if (externalPrompt && externalPrompt.trim()) {
      sendMessage(externalPrompt.trim());
    }
  }, [externalPrompt]);

  const sendMessage = async (textToSend = null) => {
    const query = textToSend || input.trim();
    if (!query || loading) return;

    if (!textToSend) setInput('');
    setError(null);

    const userMsg = {
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await api.agentChat(sessionId, query);

      const agentMsg = {
        sender: 'agent',
        text: res.response?.text || 'Request processed.',
        tool_log: res.tool_log || [],
        options: res.response?.options || null,
        compare: res.response?.compare || null,
        disruption: res.response?.disruption || null,
        recovery: res.response?.recovery || null,
        booking: res.response?.booking || null,
        confirmation: res.response?.confirmation || null,
        approval_gate: res.response?.approval_gate || null,
        missing_fields: res.response?.missing_fields || null,
        disruption_causes: res.response?.disruption_causes || null,
        revision_suggestions: res.response?.revision_suggestions || null,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, agentMsg]);
      setSessionInfo({
        state: res.session_state,
        context: res.context || {},
      });

      // Synchronize context and results with parent workspace
      if (onSyncContext) {
        onSyncContext({
          context: res.context || {},
          options: res.response?.options || (res.response?.recovery?.options) || null,
          disruptionState: res.disruption_state || {},
          sessionState: res.session_state,
          selectedItinerary: res.response?.selected_itinerary || null,
          confirmation: res.response?.confirmation || null,
          toolLog: res.tool_log || [],
        });
      }
    } catch (err) {
      setError(err.message || 'Failed to talk to travel concierge agent.');
      setMessages((prev) => [
        ...prev,
        {
          sender: 'agent',
          text: `⚠️ Error: ${err.message || 'Service temporarily unavailable. Please retry.'}`,
          isError: true,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const quickPrompts = [
    'I need to travel from Visakhapatnam to Vijayawada tomorrow. My budget is ₹1,500, I need to arrive before 7 PM, and I prefer fewer transfers.',
    'నాకు విశాఖపట్నం నుండి విజయవాడకు ప్రయాణం చేయాలి. బడ్జెట్ ₹1,500.',
    'Compare candidate routes',
    'Simulate delay on TN-203 by 30 minutes',
    'Recover remaining journey after disruption',
    'I select itin-1',
    'Approve booking',
  ];

  return (
    <div className="agent-chat-container">
      {/* Header Bar */}
      <div className="agent-chat-header">
        <div className="agent-title-group">
          <div className="agent-avatar-pulse">🤖</div>
          <div>
            <h3 className="agent-title">JourneyIQ Autonomous Travel Concierge</h3>
            <p className="agent-subtitle">
              Natural Language Interface • Tool Orchestration • Deterministic Feasibility Validation
            </p>
          </div>
        </div>

        <div className="agent-status-pills">
          <span className={`status-pill status-${sessionInfo.state}`}>
            Workflow State: <strong>{sessionInfo.state.toUpperCase()}</strong>
          </span>
          {sessionInfo.context?.origin && (
            <span className="context-pill">
              {sessionInfo.context.origin} ➔ {sessionInfo.context.destination || '?'}
            </span>
          )}
        </div>
      </div>

      {/* Main Chat Feed */}
      <div className="agent-messages-feed">
        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-message-row ${msg.sender}`}>
            <div className="chat-avatar">{msg.sender === 'agent' ? '🤖' : '👤'}</div>

            <div className="chat-bubble-wrapper">
              <div className="chat-meta">
                <span className="chat-sender-name">
                  {msg.sender === 'agent' ? 'JourneyIQ Agent' : 'Traveller'}
                </span>
                <span className="chat-timestamp">{msg.timestamp}</span>
              </div>

              <div className={`chat-bubble ${msg.isError ? 'bubble-error' : ''}`}>
                {/* Tool Log Badges */}
                {msg.tool_log && msg.tool_log.length > 0 && (
                  <div className="tool-execution-trace">
                    <div className="tool-trace-label">⚡ Agent Tools Invoked ({msg.tool_log.length}):</div>
                    <div className="tool-tags">
                      {msg.tool_log.map((t, tidx) => (
                        <span key={tidx} className="tool-tag" title={JSON.stringify(t)}>
                          ⚙️ {t.tool} {t.success !== false ? '✓' : '⚠️'}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Message Text */}
                <div className="chat-text-content">
                  {msg.text.split('\n').map((paragraph, pIdx) => (
                    <p key={pIdx} style={{ margin: paragraph.trim() ? '4px 0' : '0' }}>{paragraph}</p>
                  ))}
                </div>

                {/* Missing fields prompt */}
                {msg.missing_fields && msg.missing_fields.length > 0 && (
                  <div className="missing-fields-box">
                    <span>Required travel constraints missing: </span>
                    {msg.missing_fields.map((f, fidx) => (
                      <span key={fidx} className="field-badge">{f}</span>
                    ))}
                  </div>
                )}

                {/* Disruption Alert Card */}
                {msg.disruption && (
                  <div className="agent-disruption-card">
                    <div className="disruption-header">
                      <span>⚡ Disruption Incident Logged</span>
                      <span className="badge-delay">
                        {msg.disruption.disruption_type?.toUpperCase()}
                        {msg.disruption.delay_minutes ? ` +${msg.disruption.delay_minutes}m` : ''}
                      </span>
                    </div>
                    <p style={{ fontSize: 13, margin: '6px 0' }}>
                      <strong>Service {msg.disruption.service_id}:</strong> {msg.disruption.description}
                    </p>

                    <div style={{ marginTop: 8 }}>
                      <button
                        className="btn btn-amber btn-sm"
                        onClick={() => sendMessage('recover journey')}
                      >
                        🔄 Ask Agent to Recover Remaining Journey
                      </button>
                    </div>
                  </div>
                )}

                {/* Recovery Failure Details */}
                {msg.disruption_causes && msg.disruption_causes.length > 0 && (
                  <div className="missing-fields-box" style={{ background: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' }}>
                    <strong>Attributed Causes:</strong>
                    <ul style={{ paddingLeft: 16, marginTop: 4 }}>
                      {msg.disruption_causes.map((c, i) => <li key={i}>{c.description}</li>)}
                    </ul>
                  </div>
                )}

                {/* Itinerary Options Cards */}
                {msg.options && msg.options.length > 0 && (
                  <div className="agent-options-grid">
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-accent)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Validated Journey Alternatives:
                    </div>
                    {msg.options.map((opt, oidx) => {
                      const isSelected = selectedItineraryId === opt.id;
                      return (
                        <div
                          key={oidx}
                          className="agent-option-card"
                          style={{
                            borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border)',
                            background: isSelected ? 'rgba(37, 99, 235, 0.08)' : '#FFFFFF'
                          }}
                        >
                          <div className="opt-header">
                            <span className="opt-badge">{opt.tag || `Option ${oidx + 1}`}</span>
                            <span className="opt-price">₹{opt.summary?.totalCostAllPassengers}</span>
                          </div>

                          <div className="opt-route" style={{ margin: '8px 0' }}>
                            {opt.legs.map((leg, lidx) => (
                              <div key={lidx} className="leg-summary" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                                <span className="leg-mode">
                                  {leg.type === 'flight' ? '✈️' : leg.type === 'train' ? '🚆' : '🚌'}
                                </span>
                                <strong>{leg.service_id}</strong>
                                <span>{leg.origin} ➔ {leg.destination}</span>
                                <span style={{ color: 'var(--text-muted)' }}>({leg.operator})</span>
                              </div>
                            ))}
                          </div>

                          {opt.explanation && (
                            <div style={{ fontSize: 11.5, color: 'var(--accent-primary)', background: 'rgba(37,99,235,0.08)', padding: '6px 8px', borderRadius: 4, margin: '6px 0' }}>
                              💡 {opt.explanation}
                            </div>
                          )}

                          <div className="opt-footer">
                            <span>⏱️ {opt.summary?.totalDurationFormatted}</span>
                            <span>Arrives: <strong>{opt.summary?.arrival?.split('T')[1]?.slice(0,5)}</strong></span>
                            <span>🔄 {opt.summary?.transfers} transfer(s)</span>
                            <button
                              className="btn-select-itin"
                              style={{ background: isSelected ? 'var(--accent-green)' : 'var(--accent-primary)' }}
                              onClick={() => {
                                if (onSelectItinerary) onSelectItinerary(opt);
                                sendMessage(`I select ${opt.id}`);
                              }}
                            >
                              {isSelected ? '✓ Selected' : 'Select Option'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Comparison Matrix */}
                {msg.compare && msg.compare.compared && msg.compare.compared.length > 0 && (
                  <div className="agent-compare-box">
                    <h4>📊 Itinerary Comparison Matrix</h4>
                    <div className="compare-table-wrapper">
                      <table className="compare-table">
                        <thead>
                          <tr>
                            <th>Option</th>
                            <th>Mode</th>
                            <th>Fare</th>
                            <th>Duration</th>
                            <th>Key Advantage</th>
                            <th>Trade-Off</th>
                          </tr>
                        </thead>
                        <tbody>
                          {msg.compare.compared.map((item, cidx) => (
                            <tr key={cidx} className={item.id === msg.compare.recommendation ? 'recommended-row' : ''}>
                              <td>
                                <strong>{item.id}</strong>
                                {item.id === msg.compare.recommendation && <span className="rec-star"> ★ Top Match</span>}
                              </td>
                              <td>{item.mode}</td>
                              <td>₹{item.total_cost}</td>
                              <td>{item.duration}</td>
                              <td className="pro-cell">{item.pros?.join(', ') || '—'}</td>
                              <td className="con-cell">{item.cons?.join(', ') || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Approval Gate Banner */}
                {msg.approval_gate && (
                  <div className="approval-gate-banner">
                    <div className="gate-icon">🔒</div>
                    <div className="gate-text">
                      <strong style={{ color: 'var(--text-primary)' }}>Confirm Journey Change</strong>
                      <p>
                        Confirm itinerary {msg.approval_gate.itinerary_id} for {msg.approval_gate.passengers} passenger(s) at total ₹{msg.approval_gate.total_cost}?
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-approve" onClick={() => sendMessage('approve')}>
                        ✓ Approve Change
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => sendMessage('no keep plan')}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Booking Confirmation Card */}
                {(msg.booking || msg.confirmation) && (
                  <div className="booking-confirmed-card">
                    <div className="confirmed-badge">✅ JOURNEY CONFIRMED</div>
                    <div className="pnr-code">
                      PNR: {msg.booking?.pnr || msg.confirmation?.confirmation_id}
                    </div>
                    <div className="booking-details">
                      <div>Passengers: {msg.booking?.passengers || msg.confirmation?.passengers}</div>
                      <div>Total Cost: ₹{msg.booking?.total_cost || msg.confirmation?.total_cost}</div>
                      <div>Status: CONFIRMED</div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                      ⚠️ No real tickets are reserved or payment processed. All data is for demonstration only.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="chat-message-row agent">
            <div className="chat-avatar">🤖</div>
            <div className="chat-bubble agent thinking-bubble">
              <span className="thinking-dots">Agent orchestrating tools: parsing constraints & validating timetables... ⚡</span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Quick Action Suggestion Chips */}
      <div className="agent-quick-prompts">
        <span className="chips-label">Quick Prompts:</span>
        {quickPrompts.map((p, idx) => (
          <button
            key={idx}
            className="chip-btn"
            onClick={() => sendMessage(p)}
            disabled={loading}
          >
            {idx === 0 ? '📍 Sample Query' : p}
          </button>
        ))}
      </div>

      {/* Input Bar */}
      <div className="agent-input-bar">
        <textarea
          className="agent-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask JourneyIQ agent (e.g. 'I need to travel from Visakhapatnam to Vijayawada tomorrow budget ₹1,500' or 'నాకు విశాఖపట్నం నుండి విజయవాడకు ప్రయాణం చేయాలి')..."
          rows={2}
          disabled={loading}
        />
        <button
          className="btn-send-agent"
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
        >
          Send 🚀
        </button>
      </div>
    </div>
  );
}
