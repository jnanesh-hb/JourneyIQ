# JourneyIQ — Intelligence for Every Connection
### Team InnovateX · SAMARTHA Hackathon 2026 · Agentic AI in Travel Tech

> ⚠️ **SYNTHETIC DATA DISCLAIMER**: All transport schedules, fares, operators, and services in this application are **simulated for demonstration purposes only**. No real bookings, payments, or transport connections are made. This is a hackathon prototype designed to prove autonomous multimodal travel planning and deterministic adaptive journey recovery.

---

## 🚀 Quick Start

You need **Node.js 18+** installed. The stack is fully zero-setup (Node.js/Express backend + React/Vite frontend).

### 1. Start Backend (Port 3001)
```powershell
cd backend
npm install
npm start
```
*Health check:* `http://localhost:3001/api/health`

### 2. Start Frontend (Port 5173)
```powershell
cd frontend
npm install
npm run dev
```
*Web App:* `http://localhost:5173`

### 3. Run Automated Tests
```powershell
cd backend
# 16/16 Functional End-to-End Tests
node tests.js

# 20/20 Comprehensive Agent Verification Suite (R01-R20)
node agent_test.js
```

---

## 🎯 Mandatory Hackathon Demo Flow (1-Click Ready)

1. Open `http://localhost:5173`.
2. Click **Scenario 1: Mandatory Demo Flow (Vizag → Vijayawada)** in the left panel.
   - The query: `"Plan travel from Visakhapatnam to Vijayawada tomorrow. Budget is ₹1,500, arrive before 7 PM, prefer fewer transfers."`
   - The agent parses constraints, runs bounded graph search, Pareto filtering, and recommends **TN-201 (Vande Bharat Express)** at ₹1,150, 4h 00m, direct, 96% reliability score.
3. Click **Select & Review Route** or choose it in the card to lock the active itinerary.
4. Click **Scenario 2: Inject Disruption & Trigger Recovery**.
   - Simulates a 90-minute delay on `TN-201`.
   - The recovery engine diagnoses the delay, re-runs constraint feasibility, flags deadline violation (arrival pushed to 19:30, violating the 19:00 deadline), and surfaces deterministic recovery options:
     - **BU-202 (APSRTC Amaravati Volvo)** — ₹680, arriving 18:30 (Feasible).
     - **TN-203 (Ratnachal Express)** — ₹450, arriving 18:45 (Feasible & Budget-Friendly).
5. Switch to **Route Map & Schematic Timeline** to see the comparative schedule timeline.
6. Check **Human Approval Safety Boundary** in the right panel and click **Approve & Commit Route Change**.
   - JourneyIQ records the decision into the **Decision Audit Log** with an immutable audit hash.

---

## 🧠 Core Agent Tools

JourneyIQ operates on a strict **Agent-First Tool Execution Pattern**. The reasoning engine delegates to deterministic validation functions rather than hallucinating transport facts:

1. `parse_travel_request` — Extracts origin, destination, relative/absolute dates ("tomorrow"), passenger count, max budget (INR), arrival deadline, mode preferences, and accessibility tags.
2. `search_itineraries` — Executes bounded multimodal graph search across synthetic schedules with minimum 45-minute transfer buffers.
3. `validate_itinerary` — Deterministically checks per-passenger budget, arrival deadlines, buffer safety, and seat availability.
4. `compare_itineraries` — Evaluates Pareto efficiency, sorts trade-offs, and generates transparent trade-off rationale tags.
5. `simulate_disruption` — Injects realistic operational delays or cancellations without mutating permanent service schedules.
6. `recover_journey` — Evaluates disruption impact, checks transfer feasibility, identifies violations, and generates deterministic recovery alternatives.
7. `confirm_simulated_option` — Enforces an explicit human confirmation boundary before committing changes to active journeys.

---

## 🛠️ Architecture & System Design

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           JourneyIQ Frontend (React + Vite :5173)                 │
│  ┌───────────────────────┬───────────────────────────────┬─────────────────────┐ │
│  │ 1-Click Demo Scenarios│ 5 Central Functional Tabs:    │ Active Trip Status  │ │
│  │ & Live Constraints    │ 1. Agent Concierge Chat       │ & Disruption Alert  │ │
│  │ Origin/Destination/   │ 2. Compare Routes (Trade-offs)│ & Human Approval    │ │
│  │ Budget/Deadline/Date  │ 3. Schematic Node Timeline    │ Safety Boundary     │ │
│  │ Quick-fill Chips      │ 4. Disruption Lab             │ Immutable Audit Log │ │
│  │                       │ 5. Decision Audit Log         │                     │ │
│  └───────────────────────┴───────────────────────────────┴─────────────────────┘ │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ REST & Agent Message API
┌────────────────────────────────────────▼─────────────────────────────────────────┐
│                           JourneyIQ Backend (Node.js Express :3001)               │
│                                                                                  │
│   server.js ──────────► parser.js (Natural language regex & constraint parsing)  │
│         │                                                                        │
│         ├─────────────► planner.js (Multimodal graph search & Pareto filter)     │
│         │                     ├─ Bounded candidate generation (direct + 2-leg)   │
│         │                     ├─ 45-min minimum transfer buffer check            │
│         │                     ├─ Deterministic feasibility validator             │
│         │                     └─ Reliability & risk scoring engine               │
│         │                                                                        │
│         ├─────────────► agent.js (Autonomous orchestrator & 7 agent tools)       │
│         │                     ├─ Tool dispatch & trace generation                │
│         │                     └─ Disruption recovery planner                     │
│         │                                                                        │
│         └─────────────► data/services.json (25 synthetic multimodal services)    │
│                               In-memory tripStore & decision audit trails        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Synthetic Dataset (25 Services)

The dataset covers high-density Indian inter-city corridors with multimodal options (Train, Bus, Flight):
- **Visakhapatnam ↔ Vijayawada corridor:**
  - `TN-201`: Vande Bharat Express (Direct, ₹1,150, 4h 00m)
  - `BU-202`: APSRTC Amaravati Volvo (Direct, ₹680, 5h 30m)
  - `TN-203`: Ratnachal Express (Direct, ₹450, 5h 45m)
  - `TN-204` + `TN-205`: Multi-leg via Rajahmundry with 50-min safe transfer buffer
  - `TN-206`: Connecting leg with tight 15-min transfer buffer (rejected by buffer validator)
  - `BU-207`: APSRTC Garudavega night recovery coach
  - `FL-208`: Indigo regional flight (exceeds demo budget)
- **Hyderabad ↔ Chennai / Bengaluru / Mumbai / Delhi corridors:**
  - Multiple connecting trains, intercity sleeper buses, and express flights for rich cross-modal comparisons.

---

## 🧪 Automated Test Verification

### Backend Functional Tests (`backend/tests.js`): 16 / 16 PASS
- Health endpoint validation & dataset verification
- Direct and multi-leg multimodal routing
- 45-minute minimum transfer buffer enforcement (rejects sub-buffer transfers)
- Budget constraint enforcement (excludes expensive flights)
- Arrival deadline filter enforcement
- Delay and cancellation injection with recovery replanning
- Honest "no feasible route" explanation when all corridors are disrupted
- Human approval boundary enforcement

### Agent Verification Suite (`backend/agent_test.js`): 20 / 20 PASS
- `R01`: Parse natural language prompt with dates, budget, and deadline
- `R02`: Fallback parsing with defaults
- `R03`: Relative date resolution ("tomorrow" / "today")
- `R04`: Direct itinerary search
- `R05`: Multi-leg itinerary generation
- `R06`: 45-min transfer buffer violation rejection
- `R07`: Budget constraint filtering
- `R08`: Arrival deadline constraint filtering
- `R09`: Single passenger cost calculation
- `R10`: Multi-passenger cost scaling
- `R11`: Disruption delay simulation & timestamp calculation
- `R12`: Disruption cancellation simulation
- `R13`: Disruption impact detection on itinerary
- `R14`: Upstream delay breaking downstream transfer buffer
- `R15`: Recovery option generation under disruption
- `R16`: Honest explanation when no alternatives exist
- `R17`: Human confirmation tool execution
- `R18`: Unapproved confirmation rejection
- `R19`: End-to-end Mandatory Demo Scenario
- `R20`: Decision audit logging & hash generation

---

## 🛡️ Safety & Reliability Boundaries

1. **Deterministic Over Generative**: The system never guesses timetables or invents imaginary connections. All routes are checked against graph feasibility and real timetable buffers.
2. **Human Approval Gate**: Disruptions or route modifications cannot modify the active booking without an explicit user confirmation signature (`user_confirmed: true`).
3. **Transparent Trade-offs**: Every alternative shows clear deltas (Fare Δ, Time Δ, Risk factor Δ) so travelers can make informed decisions.
4. **Synthetic Disclaimer**: Visible in the UI header, footer, agent responses, and API health endpoint.
