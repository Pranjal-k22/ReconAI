# ReconAI Memory

## Project Identity
ReconAI - AI-Assisted Financial Reconciliation Platform with Deterministic Safety & Auditability.

## Hackathon Track
Financial Tech / AI Automation / Reconciliation Engine.

## Core Objective
Ingest merchant orders, gateway payments, and settlement records, run deterministic matching rules, classify anomalies, isolate low-confidence exceptions for Gemini AI investigation, and maintain an immutable audit trail.

## Tech Stack
- Frontend: React (Vite, JavaScript), Tailwind CSS, Lucide Icons, Axios, Recharts.
- Backend: Node.js + Express API (ES modules).
- Database: MongoDB + Mongoose.
- AI Service: Google Gemini API (used strictly for exception root cause investigation, fallback explanations, and human-in-the-loop recommendations; NOT for direct matching).

## Architecture Decisions
- Full-stack monorepo structure with `client/` and `server/` managed by root `package.json` with `concurrently`.
- Deterministic reconciliation engine runs locally in Node.js service layers.
- Strict isolation: Gemini AI cannot perform reconciliation matching.
- Ground truth dataset is stored separately to evaluate engine accuracy.

## Financial Safety Rules
- All money amounts stored as integer paise (1 INR = 100 paise) to prevent floating-point rounding errors.
- Any discrepancy (amount mismatch, fee discrepancy, missing record, status conflict) triggers an Anomaly flag.
- Financial records are immutable; audit trails record every human/AI action.

## Reconciliation Rules
- Rule 1: Exact Match (Order ID, Payment Gateway Ref, Amount, Currency).
- Rule 2: Multi-Field Fuzzy Match (Amount + Time Window + Customer Reference).
- Rule 3: Fee & Settlement Reconciliation (Gateway Fee + Tax + Net Settlement).
- Rule 4: Anomaly Classification (AMOUNT_MISMATCH, FEE_DISCREPANCY, TIMING_MISMATCH, UNMATCHED_PAYMENT, DUPLICATE_PAYMENT, REFUND_UNACCOUNTED).

## Confidence Policy
- Match confidence score between 0.00 and 1.00 calculated deterministically based on match rule weights.
- Score >= 0.95 with zero anomalies -> Auto-Reconciled.
- Score < 0.95 or any anomaly present -> Flagged as Exception for AI investigation & human review.

## AI Restrictions
- Gemini AI is restricted to exception analysis, context summarization, and resolution recommendations.
- Gemini MUST NEVER alter financial match status directly without safety rule validation.

## Dataset Strategy
- Synthetic 120-record benchmark dataset (Orders, Payments, Settlements) with known ground truth for reliable evaluation and instant demo path.

## Razorpay Strategy
- Razorpay API test mode client for syncing live payments and settlements when keys are present; graceful fallback to generated test data.

## Environment & Server Conventions
- Server Port: `process.env.PORT || 5000`.
- Client Dev Server: `http://localhost:5173`.
- Health Endpoint: `GET /api/health` -> `{ success: true, service: "reconai-api", status: "healthy" }`.
- Environment Variables: `PORT`, `NODE_ENV`, `CLIENT_URL`, `MONGODB_URI`, `GEMINI_API_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `DEMO_MODE`.

## Testing Conventions
- Vitest + Supertest for Express API integration testing (`server/tests/`).
- Benchmark evaluation script for precision/recall testing against ground truth.

## Critical Notes For Future Agents
- React uses JavaScript (JSX), not TypeScript.
- Money is ALWAYS integer paise in backend models and API payloads.
- Always check `memory.md`, `implemented.md`, `folderstr.md`, and `docs/PROGRESS.md` before making changes.
