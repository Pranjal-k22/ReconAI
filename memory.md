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
- Centralized Zod environment validation (`server/src/config/env.js`).
- Database connection lifecycle management (`server/src/config/database.js`).
- **MongoDB Startup Invariant**: MongoDB connection is mandatory before HTTP server startup in `development` and `production` modes (`MONGODB_URI` required). Server refuses to start without a valid DB connection.
- **Test Environment Independence**: In `NODE_ENV=test`, Express `app.js` can be imported by Supertest without triggering DB connection or HTTP listener locks.
- **Domain Data Layer**: 8 Mongoose models in `server/src/models/`: `MerchantOrder`, `GatewayPayment`, `SettlementRecord`, `ReconciliationRun`, `ReconciliationResult`, `ExceptionCase`, `AuditLog`, `GroundTruth`.
- **Benchmark Dataset Strategy**:
  - Dataset Version: `RECONAI_DEMO_V1`
  - Seed: `RECONAI_DEMO_2026`
  - Import Batch ID: `BATCH-DEMO-V1`
  - Size: 120 deterministic scenarios (80 MATCHED, 8 AMOUNT_MISMATCH, 6 MISSING_SETTLEMENT, 5 DUPLICATE_PAYMENT, 5 FEE_MISMATCH, 4 REFUND_MISMATCH, 4 MISSING_PAYMENT, 3 REFERENCE_MISMATCH, 3 AMBIGUOUS, 2 INVALID_DATA).
  - Synthetic Fee Policy: 2% fee + 18% GST on fee.
  - Primary ambiguous demo scenario ID: `ORD-000116`.
  - Database cleanup & reset operations MUST be scoped strictly to `importBatchId: "BATCH-DEMO-V1"` and `datasetVersion: "RECONAI_DEMO_V1"`.
- **Application Business Identifiers**: Strings (`ORD-100001`, `pay_ABC123`, `set_rec_001`, `RUN-001`, `RES-001`, `EXC-001`, `AUD-001`) indexed for high throughput queries.
- **Settlement Id Granularity**: `settlementRecordId` is unique per line item; `settlementId` groups multiple line items per batch payout.
- **Signed Difference Convention**: `differencePaise = actualAmountPaise - expectedAmountPaise`.
- **Ground Truth Isolation**: `GroundTruth` model is evaluation-only and strictly isolated from production reconciliation import paths.
- **AI / Deterministic Separation**: `deterministicExplanation` stores rule proofs; `aiExplanation` stores advisory Gemini insights.
- Deterministic reconciliation engine runs locally in Node.js service layers.
- Strict isolation: Gemini AI cannot perform reconciliation matching.

## Financial Safety Rules
- All money amounts stored as integer paise (1 INR = 100 paise) to prevent floating-point rounding errors.
- Financial arithmetic uses integer math utilities (`rupeesToPaise`, `paiseToRupees`, `formatINR`, `isValidPaise`, `safeAddPaise`, `safeSubtractPaise`).
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

## Environment & Server Conventions
- Server Port: `process.env.PORT || 5000`.
- Client Dev Server: `http://localhost:5173`.
- Environment Validation: Zod schema (`server/src/config/env.js`). Required in Dev/Prod: `PORT`, `NODE_ENV`, `CLIENT_URL`, `MONGODB_URI`. Optional: `GEMINI_API_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
- Health Endpoint: `GET /api/health` -> `200 OK` (healthy) when `database.status === "connected"`; `503 Service Unavailable` (degraded) when disconnected.
- API Error Format: `{ success: false, error: { code: string, message: string, details?: any } }`.

## Testing Conventions
- Vitest + Supertest for Express API integration testing (`server/tests/`).
- Benchmark evaluation script for precision/recall testing against ground truth.

## Critical Notes For Future Agents
- React uses JavaScript (JSX), not TypeScript.
- Money is ALWAYS integer paise in backend models and API payloads.
- Always check `memory.md`, `implemented.md`, `folderstr.md`, and `docs/PROGRESS.md` before making changes.
