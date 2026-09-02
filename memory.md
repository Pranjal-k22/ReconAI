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
- **Ground Truth Isolation**: `GroundTruth` model is evaluation-only and strictly isolated from production reconciliation import paths (`groundTruthIsolationGuard.test.js` enforces zero imports in `server/src/services/reconciliation/`). GroundTruth is imported ONLY in `server/src/services/evaluation/evaluationService.js`.
- **Pure In-Memory Reconciliation Engine**: Engine (`reconcileScenario`) is 100% pure, deterministic, and in-memory (`server/src/services/reconciliation/matchingEngine.js`). It never queries/mutates MongoDB, never calls Gemini or Razorpay.
- **Reconciliation Run Persistence & Unique Compound Index**: Runs persist exactly one `ReconciliationResult` document per scenario. Compound index `{ runId: 1, merchantOrderId: 1 }` prevents duplicate results within a run.
- **Run Resolution Safety Gate Rule**: Only `classification === "MATCHED"` AND `confidence >= 0.95` AND `requiresReview === false` may auto-reconcile (`safetyGateService.js`). All anomaly classifications (`AMOUNT_MISMATCH`, `AMBIGUOUS`, etc.) FORCE `allowedAutomaticResolution = false` and `requiresHumanReview = true` regardless of confidence score.
- **ExceptionCase & Deterministic Classification Preservation**: Every result requiring review generates an `ExceptionCase`. Human review decisions (`APPROVE_MATCH`, `KEEP_EXCEPTION`, `MARK_RESOLVED`) change workflow state (`resolutionStatus`, `humanDecision`, `requiresReview`), but NEVER alter original `ReconciliationResult.classification`. `APPROVE_MATCH` is a human operational resolution, not a system reclassification.
- **Compound Unique Index on ExceptionCase**: `{ runId: 1, resultId: 1 }` uniquely identifies an exception case per run.
- **Centralized Append-Only Audit Trail**: `auditService.js` centrally writes all audit events. The REST API exposes `GET /api/audit` and `GET /api/audit/:eventId` only; no UPDATE or DELETE routes exist.
- **Recursive Audit Secret Sanitization**: All audit fields (`before`, `after`, `metadata`) undergo recursive key sanitization redacting secret keys (`GEMINI_API_KEY`, `RAZORPAY_KEY_SECRET`, `authorization`, etc.) to `"[REDACTED]"`.
- **Primary Demo Ambiguous Failure Case**: `ORD-000116` is classified as `AMBIGUOUS` (`confidence = 0.45`). During live demonstration, `KEEP_EXCEPTION` is applied, preserving its `UNDER_REVIEW` state and `AMBIGUOUS` classification for hackathon presentation.
- **Operational vs Evaluation Metrics**: Operational metrics (`metricsService.js`) calculate counts, financial totals, throughput, and rates without GroundTruth. Benchmark evaluation (`evaluationService.js`) calculates accuracy, precision, recall, and F1 by comparing results against GroundTruth.
- **Evidence Hierarchy Rule**: Amount alone can NEVER establish a match between transactions. Match hierarchy requires direct order reference (`merchantOrderId`) or entity linkage (`settlementRecord.entityId === gatewayPayment.gatewayPaymentId`).
- **Signed Difference Convention**: `differencePaise = actualAmountPaise - expectedAmountPaise`. Missing values (`MISSING_PAYMENT`) keep `actualAmountPaise = null` and `differencePaise = null` (missing values are never faked as 0).
- **Deterministic Confidence Model**: Confidence (0.00 - 1.00) measures evidence strength, not financial permission. All anomaly classifications require review (`requiresReview = true`).
- **Primary Ambiguous Demo Scenario**: `ORD-000116` with two payment candidates and unlinked settlement is deterministically classified as `AMBIGUOUS` (`requiresReview = true`, `confidence = 0.45`). Engine never guesses.
- **Synthetic Fee Policy**: Standard synthetic fee (2% gross + 18% GST on fee) encapsulated in `server/src/services/finance/syntheticFeePolicy.js`.
- **Engine Version**: `RECON_ENGINE_V1`.
- **AI / Deterministic Separation**: Gemini AI cannot perform primary matching or classification.
- **Gemini Advisory Exception Investigator Boundary**:
  - Gemini is invoked strictly on-demand via `POST /api/exceptions/:exceptionId/investigate`.
  - Gemini is NEVER invoked during batch reconciliation runs (`POST /api/reconciliation/runs`).
  - Provider integration uses official `@google/genai` SDK with `GEMINI_MODEL` (default `gemini-2.5-flash`).
  - AI input is minimized and strictly excludes `GroundTruth`, API credentials, raw provider payloads, internal database keys, and customer PII.
  - AI structured JSON output is validated at runtime via Zod (`aiAnalysisOutputSchema`).
  - AI recommendations use a strict enum allow-list (`ALLOWED_RECOMMENDED_NEXT_STEPS`); forbidden execution actions (`REFUND_CUSTOMER`, `CAPTURE_PAYMENT`, `APPROVE_MATCH`, etc.) are rejected by schema.
  - Server-side advisory safety override normalizes any `NO_ACTION` recommendation on anomaly classifications to `MANUAL_REVIEW`.
  - Gemini failure (missing key, timeout >15s, quota, network error, invalid JSON) triggers deterministic fallback (`fallbackExplanation.js`), logging `AI_INVESTIGATION_FAILED` and returning HTTP 200 with `source: "FALLBACK"`.
  - AI cannot modify `classification`, `confidence`, `severity`, `financialImpactPaise`, `status`, `humanDecision`, `requiresReview`, or `resolutionStatus`.
  - AI investigation logs append-only audit events (`AI_INVESTIGATION_REQUESTED`, `AI_INVESTIGATION_COMPLETED`, `AI_INVESTIGATION_FAILED`).
  - Primary ambiguous scenario `ORD-000116` remains human-controlled (`AMBIGUOUS`, `confidence = 0.45`, `status = UNDER_REVIEW`, `humanDecision = KEEP_EXCEPTION`) regardless of AI investigation output.
- **Razorpay Test Mode Read-Only Adapter Boundary**:
  - Razorpay integration is strictly Test Mode (`RAZORPAY_MODE=test`) and read-only (GET requests only).
  - Safety guard `validateTestModeSafety()` blocks synchronization if a live Key ID (`rzp_live_...`) is configured.
  - Razorpay credentials (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) are optional during server startup and strictly server-side (Basic Auth). Secrets are never exposed to client or logs.
  - Payments fetched from `/v1/payments` with count/skip pagination (max 1000 sync limit).
  - Customer PII (`email`, `contact`, `vpa`, `card_id`, `card` payload) is stripped prior to saving in `rawData`.
  - Razorpay `order_id` is preserved as provider metadata; `GatewayPayment.merchantOrderId` is left `null` unless explicit safe mapping exists.
  - Settlement recon fetched from `/v1/settlements/recon/combined`.
  - Settlement records use deterministic IDs (`RZPREC-hash`) and signed net amount conventions (`credit > 0` positive net, `debit > 0` negative net).
  - Razorpay records use actual provider fee/tax values and NEVER use `syntheticFeePolicy.js`.
  - Razorpay synchronization does NOT automatically trigger reconciliation execution.
  - Razorpay failure logs `RAZORPAY_SYNC_FAILED` audit events without affecting synthetic benchmark runs.

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

## Frontend Architecture & Conventions
- ReconAI frontend is React + Vite + JavaScript + Tailwind CSS.
- Frontend uses centralized Axios API modules (`client/src/api/`).
- Dashboard is 100% API-driven; benchmark metrics and financial totals are never hard-coded.
- Null financial values display as unavailable (`—`), never `₹0`.
- Deterministic confidence is labeled "Evidence Confidence".
- Gemini output is labeled "Advisory only"; Fallback analysis is visually distinguished with a "Deterministic Fallback" badge.
- Razorpay credentials are never entered or exposed in the frontend.
- Human review decisions preserve the original deterministic classification for auditability.
- Primary hackathon demo path: Dashboard -> Run -> Exceptions -> ORD-000116 -> AI -> Human Review -> Audit -> Evaluation.

## Critical Notes For Future Agents
- React uses JavaScript (JSX), not TypeScript.
- Money is ALWAYS integer paise in backend models and API payloads.
- Always check `memory.md`, `implemented.md`, `folderstr.md`, and `docs/PROGRESS.md` before making changes.

