# ReconAI — Razorpay Test Mode Read-Only Integration Architecture

> **CRITICAL FINANCIAL SAFETY STATEMENT**: ReconAI does **NOT** initiate, capture, refund, create, modify, or execute financial transactions or money movement through Razorpay. All Razorpay operations are strictly **READ-ONLY** and **TEST-MODE ONLY**.

---

## 1. Purpose

The Razorpay Integration Adapter provides an optional external financial data ingestion source for ReconAI. It allows finance teams to fetch live/test gateway payment transactions and settlement reconciliation payout reports from Razorpay's Test Mode environment for analysis within ReconAI.

---

## 2. Test Mode Only & Read-Only Safety Guard

- **Test Mode Enforced**: ReconAI operates exclusively with Razorpay Test Mode (`RAZORPAY_MODE=test`).
- **Live Key Safety Guard**: If a live Razorpay Key ID (`rzp_live_...`) is configured while in `test` mode, the server-side safety guard (`validateTestModeSafety()`) **immediately blocks** synchronization with error `RAZORPAY_LIVE_KEY_BLOCKED`.
- **Read-Only API Boundary**: Only `GET` endpoints (`/v1/payments`, `/v1/settlements/recon/combined`) are queried. Money-moving endpoints (payment capture, refund creation, transfer, payout creation) are completely omitted from the codebase.

---

## 3. Server-Side Authentication & Secret Protection

- Backend uses Razorpay Basic Authentication: `Basic ${Buffer.from(keyId + ":" + keySecret).toString("base64")}` constructed server-side.
- Credentials (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) are optional during server startup and remain strictly server-side.
- Authorization headers and encoded credentials are automatically redacted (`[REDACTED]`) by Pino logger and `auditService.js`. Secrets are **never** exposed to the frontend, browser, or API responses.

---

## 4. Payment Synchronization & Pagination

- **Endpoint**: `GET /v1/payments`
- **Pagination**: Iterates with `count=100` and `skip` offset until all available payments within the query window are fetched.
- **Sync Safety Bound**: Enforces `MAX_RAZORPAY_SYNC_RECORDS = 1000` to protect memory and rate limits.
- **Status Mapping**:
  - `created` -> `CREATED`
  - `authorized` -> `AUTHORIZED`
  - `captured` -> `CAPTURED`
  - `failed` -> `FAILED`
  - `refunded` -> `REFUNDED`
- **Method Mapping**: `card` -> `CARD`, `upi` -> `UPI`, `netbanking` -> `NETBANKING`, `wallet` -> `WALLET`, `emi` -> `EMI`.
- **Merchant Order ID Boundary**: Razorpay `order_id` is preserved inside `rawData.razorpayOrderId`. `GatewayPayment.merchantOrderId` is left `null` unless explicit safe merchant mapping exists, protecting matching engine integrity.

---

## 5. Data Minimization & PII Handling

ReconAI strips unnecessary customer PII prior to MongoDB persistence:
- **Removed Fields**: `email`, `contact` (phone number), `vpa` (UPI VPA), `card_id`, `card` payload, and customer address notes.
- **Retained Fields**: Financial amounts, currency, status, method, timestamps, fees, taxes, and provider transaction IDs required for reconciliation.

---

## 6. Settlement Reconciliation Synchronization & Signed Net Convention

- **Endpoint**: `GET /v1/settlements/recon/combined` (Requires `year` & `month`, optional `day`).
- **Deterministic Record ID**: Each line item is assigned a stable hash-based ID:
  $$\text{settlementRecordId} = \text{RZPREC-} + \text{sha256}(\text{settlement\_id} + \text{entity\_id} + \text{type} + \text{created\_at} + \text{amount})[:12]$$
- **Signed Debit/Credit Net Amount Convention**:
  - `credit > 0` => Positive net payout (`netAmountPaise = credit` or `amount - fee - tax`).
  - `debit > 0` => Negative net payout (`netAmountPaise = -debit`).
- **Type Mapping**: `payment` -> `PAYMENT`, `refund` -> `REFUND`, `transfer` -> `TRANSFER`, `adjustment` -> `ADJUSTMENT`.

---

## 7. Idempotency & Bulk Upsert

Synchronization uses MongoDB `bulkWrite` with `upsert: true` keyed by unique provider identifiers:
- `GatewayPayment`: Upserted by `gatewayPaymentId`.
- `SettlementRecord`: Upserted by `settlementRecordId`.

Executing synchronization multiple times against the same Razorpay dataset updates existing records without creating duplicates.

---

## 8. Graceful Degradation & Error Handling

If Razorpay API is unconfigured or encounters errors (HTTP 401/403, 429, timeout, network failure):
- Server logs `RAZORPAY_SYNC_FAILED` audit event with normalized error reason.
- Synthetic reconciliation runs (`BATCH-DEMO-V1`), GroundTruth, Exception Queue, Gemini investigator, and server availability remain 100% operational.

---

## 9. Why Razorpay Sync Does Not Auto-Reconcile

Synchronization (`POST /api/razorpay/sync/payments`, `POST /api/razorpay/sync/settlements`) is decoupled from reconciliation execution:
1. Ingesting raw gateway data without merchant order records could lead to false `MISSING_PAYMENT` or `AMBIGUOUS` flags.
2. ReconAI maintains clean separation between Data Ingestion and Reconciliation Run Orchestration.

---

## 10. Synthetic vs. Razorpay Fee Rules

- Synthetic benchmark data uses `syntheticFeePolicy.js` (2% fee + 18% GST).
- Razorpay data uses **actual provider fee and tax values** (`rawPayment.fee`, `rawPayment.tax`, `rawSettlement.fee`, `rawSettlement.tax`). `syntheticFeePolicy.js` is **never** applied to Razorpay records.

---

## 11. Integration REST APIs

- `POST /api/razorpay/sync/payments` (Accepts optional `{ from, to }` Unix timestamps).
- `POST /api/razorpay/sync/settlements` (Accepts `{ year, month, day? }`).
- `GET /api/integrations/status` (Returns safe boolean configuration status for Gemini & Razorpay).

---

## 12. Known Limitations

- Test Mode settlement reconciliation reports in Razorpay depend on generated test activity in the Razorpay Dashboard.
- Merchant order linkage requires merchant platform order import before multi-way matching can execute against Razorpay payments.

---

## Track 4 Phase 4 — Safety & Audit Verification

- **Phase Status**: VERIFIED & HARDENED (PASS).
- **Verified Safety Boundaries**:
  - **Test Mode Enforced**: `validateTestModeSafety()` verified to throw `RAZORPAY_LIVE_KEY_BLOCKED` when `rzp_live_` key is supplied in test mode.
  - **Read-Only API Boundary**: `fetchRazorpayApi` executes GET requests only. Payment capture, refund creation, transfer, and payout execution methods do NOT exist in the codebase.
  - **PII Excluded**: Verified by `razorpayNormalizer.test.js` and `controllerSafetyAndHardening.test.js` that `email`, `contact` (phone), `vpa`, `card` payloads are stripped before database write.
  - **Decoupled Orchestration**: Razorpay sync creates/updates DB records without auto-reconciling or triggering financial mutations.

