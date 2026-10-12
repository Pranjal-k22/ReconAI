# ReconAI 2.0 — Phase 4: Provider Event Ingestion & Webhook Safety Specification

**Date Checked:** October 12, 2026  
**Provider Documented:** Razorpay Webhook Ingress (API v1)  
**Official Reference Inspected:**  
- Razorpay Webhooks Overview & Signature Verification: `https://razorpay.com/docs/webhooks/` (Inspected: 2026-10-12)
- Razorpay Webhook Events & Payload Specifications: `https://razorpay.com/docs/webhooks/payloads/` (Inspected: 2026-10-12)

---

## 1. Webhook Endpoint Contract

- **Ingress Route:** `POST /api/webhooks/razorpay`
- **Authentication:** HMAC-SHA256 signature verification over exact unparsed raw request bytes via `X-Razorpay-Signature`. Normal application JWT/RBAC middleware is not executed on this public webhook ingress route, preventing credential leaks while keeping other application endpoints strictly authenticated.
- **Body Parsing & Raw Byte Preservation:** Express middleware is configured with:
  ```javascript
  express.json({
    limit: "1mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
  ```
  `req.rawBody` preserves the exact original payload buffer without deserialization or key ordering alterations.
- **Payload Size Enforcement:** `1mb` hard cap enforced at Express body parser level; payloads exceeding 1MB are rejected immediately with HTTP `413 Payload Too Large`.
- **Response Codes:**
  - `200 OK`: Event accepted (`ACCEPTED`), duplicate acknowledged (`DUPLICATE_ACKNOWLEDGED`), or safely quarantined (`QUARANTINED`). Controlled JSON response returned with `{ success: true, data: { status, eventId, isDuplicate, conflictFlag, reason } }`.
  - `400 Bad Request`: Malformed JSON or malformed envelope structure violating Zod validation schema.
  - `401 Unauthorized`: Missing signature header, malformed hex signature, or cryptographic HMAC mismatch.
  - `413 Payload Too Large`: Payload body exceeding 1MB limit.
  - `500 Internal Server Error`: Missing configured `RAZORPAY_WEBHOOK_SECRET` (fails closed, returning generic error without leaking secret names or internals).

---

## 2. Configuration & Secrets

- **Webhook Secret Key:** Configured via environment variable `RAZORPAY_WEBHOOK_SECRET`.
- **Fail-Closed Guarantee:** If `RAZORPAY_WEBHOOK_SECRET` is null, undefined, empty, or whitespace, the ingestion service throws `500 Internal Server Error` and immediately halts processing. Under no circumstances will a fallback secret be assumed or verification bypassed.
- **Zero Secret Commits:** No actual secrets, test keys, or production credentials are hardcoded or committed to git. Only schema and test fixtures utilizing dynamic or mock strings are used.

---

## 3. Cryptographic Verification & Hardening

1. **Format Validation:** Signature must be exactly 64 hexadecimal characters (`/^[0-9a-fA-F]{64}$/`). Malformed signatures are rejected prior to buffer allocation.
2. **Constant-Time Comparison:** Verified using `crypto.timingSafeEqual(sigBuffer, expectedBuffer)` to prevent timing side-channel attacks.
3. **Exact Raw Bytes:** HMAC calculation operates on `Buffer.from(req.rawBody)`. Any change in whitespace, indentation, or key ordering between signing and verification invalidates the signature.
4. **Pre-verification Isolation:** Cryptographic verification is executed strictly BEFORE any database lookup, key reservation, or state mutation. An invalid signature can NEVER reserve a deduplication key or poison subsequent legitimate ingestion.
5. **Log Sanitization:** Sensitive payload fields (`password`, `token`, `secret`, `authorization`, `cookie`, `key`, `gemini_api_key`) are recursively redacted to `[REDACTED]` prior to audit logging or storage in `PaymentLifecycleEvent.normalizedPayload`.

---

## 4. Durable Event Identity, Deduplication & Replay Hardening

Razorpay documents the HMAC signature as verifying the raw request body, while the `X-Razorpay-Event-Id` header is passed separately for delivery idempotency. Because the separate header is not cryptographically signed within the HMAC body digest, ReconAI 2.0 implements a **two-tier deduplication defense**:

1. **Header-Scoped Deduplication Key:**
   `deduplicationKey = "RAZORPAY:" + accountId + ":" + headerEventId` (or fallback `RAZORPAY_FALLBACK:...`).
   Enforced via MongoDB unique index:
   `deduplicationKey: { type: String, required: true, unique: true, index: true }`
2. **Account-Scoped Raw Body SHA-256 Fingerprint (`accountBodyHash`):**
   `accountBodyHash = "RAZORPAY_BODY:" + accountId + ":" + sha256(rawBytes)`
   Enforced via MongoDB sparse unique index:
   `accountBodyHash: { type: String, unique: true, sparse: true, index: true }`
3. **Modified-Header Replay Defense:**
   If a replay arrives with the exact same signed body and signature but with a *changed or spoofed `X-Razorpay-Event-Id` header*, the `accountBodyHash` index intercepts it. The request is idempotently acknowledged as `DUPLICATE_ACKNOWLEDGED` (`isDuplicate: true`), creating zero duplicate records and executing zero state changes.
4. **Event-ID Payload Tampering / Collision Defense:**
   If a known event ID arrives with a *different* signed raw body hash (payload tampering or provider event ID collision), it is NOT acknowledged as an ordinary duplicate. The request is quarantined with status `QUARANTINED`, reason `EVENT_ID_PAYLOAD_MISMATCH`, an audit alert is logged, and canonical payment state remains completely untouched.
5. **Concurrency & Race Conditions:**
   Concurrent duplicate deliveries (whether matching on `deduplicationKey` or `accountBodyHash`) are caught via MongoDB `E11000` duplicate key exceptions. The system retrieves the existing event and returns `DUPLICATE_ACKNOWLEDGED`, ensuring database consistency across multi-process deployments.

---

## 5. Replay, Late-Event Safety & Canonical State Progression

1. **Timestamp Headers Policy:**
   Official Razorpay webhooks do NOT support custom signed timestamp headers (such as Stripe's `t=` header). Delivery time is derived from the envelope's `created_at` field (seconds since UNIX epoch), while `ingestedAt` records local server receipt time. ReconAI does NOT invent a signed delivery-timestamp header or reject legitimate provider retries across Razorpay's documented 24-hour retry window based on an undocumented age threshold.
2. **Protection Against Delayed Regressions:**
   Once a payment reaches `CAPTURED`, a delayed or out-of-order `payment.failed` event cannot regress `GatewayPayment.status` to `FAILED` or `PaymentCase.captureStatus` to `CAPTURE_FAILED`. The failed event is durably recorded in `PaymentLifecycleEvent` as immutable evidence, but canonical progression is preserved.
3. **Late Capture on CANCELLED Orders:**
   If a valid `payment.captured` event arrives for a merchant order previously marked `CANCELLED`:
   - `MerchantOrder.status` remains `CANCELLED` (no automatic cancellation reversal or reopen).
   - `GatewayPayment.status` records provider truth as `CAPTURED`.
   - `PaymentCase` flags `discrepancyCategory: "CANCELLED_ORDER_CAPTURED"`, `safeHoldCode: "LATE_CAPTURE_CANCELLED_ORDER"`, `orderStatus: "ORDER_CANCELLED"`, and `resolutionCaseStatus: "CASE_SAFE_HOLD"`.
   - The response returns `conflictFlag: "CANCELLED_ORDER_CAPTURED"`.
   - No automatic refund, transfer, or write API is executed.
4. **Late Capture After Initial Payment Failure:**
   If an async bank confirmation arrives for a payment entity previously recorded as `FAILED`:
   - `GatewayPayment.status` transitions to `CAPTURED`, setting `isLateCapture: true` and `previousStatus: "FAILED"`.
   - `PaymentCase` flags `discrepancyCategory: "STATUS_MISMATCH"`, `safeHoldCode: "ADMIN_HOLD"`, and `resolutionCaseStatus: "CASE_SAFE_HOLD"`.
   - The event is durably recorded in `PaymentLifecycleEvent` with `conflictFlag: "LATE_CAPTURE_AFTER_FAILURE"`.
5. **Multiple Payment Attempts for Same Order:**
   When a customer makes multiple payment attempts for a single order (e.g. Attempt 1 fails, Attempt 2 succeeds), each attempt is keyed by its unique `gatewayPaymentId`. Attempt 1 remains `FAILED`, Attempt 2 records `CAPTURED`, and `PaymentCase` resolves to `captureStatus: "CAPTURE_CAPTURED"`. Neither attempt overwrites or corrupts the other.

---

## 6. Correlation, Tenant Isolation & Quarantining

- **Authoritative Tenant Derivation:**
  1. `payload.payment.entity.notes.tenantId`
  2. Matching `MerchantOrder.tenantId` (correlated via `order_id`)
  3. Matching `GatewayPayment.tenantId` (correlated via `gatewayPaymentId`)
- **Cross-Tenant Injection Defense:**
  If `notes.tenantId` claims Tenant A, but the referenced `merchantOrderId` belongs to Tenant B, an `ACCESS_DENIED_ALERT` audit entry is created. The event is quarantined with `status: "QUARANTINED"`, reason: `CROSS_TENANT_MISMATCH`. Tenant B's order is never exposed or modified.
- **Unmatched Tenant:** Quarantined with `QUARANTINED_UNRESOLVED_TENANT`.
- **Unsupported Event Types:** Quarantined with `QUARANTINED_UNSUPPORTED_EVENT_TYPE`.

---

## 7. Automated Test Verification Summary

| Test Suite | File Path | Test Count | Result |
|------------|-----------|------------|--------|
| Webhook Signatures & Middleware | `server/tests/webhook/webhookSignature.test.js` | 10 | **PASS (10/10)** |
| Webhook Ingestion, Deduplication, Replay & Correlation | `server/tests/webhook/webhookIngestion.test.js` | 15 | **PASS (15/15)** |
| Real MongoDB Webhook Persistence Integration | `server/tests/integration/webhookPersistence.integration.test.js` | 8 | **PASS (8/8)** |
| Real MongoDB Service Persistence Integration | `server/tests/integration/servicePersistence.integration.test.js` | 10 | **PASS (10/10)** |
| Full Real MongoDB Integration Test Suite | `npm run test:integration` | 18 | **PASS (18/18)** |
| Full Backend Unit Test Suite | `npm test` across all 53 test files | 329 | **PASS (329/329)** |
| Synthetic Reconciliation Benchmark | `tests/reconciliation/benchmarkCompatibility.test.js` | 120 / 120 | **100.00% MATCH** |
| Frontend Production Build | `npm run build` in `client/` | Vite v5.4.21 bundle | **PASS (0 errors)** |
| Git Diff / Whitespace Check | `git diff --check` | Clean working tree | **0 errors** |

---

## 8. Safety & Compliance Confirmation

- **Zero Financial Writes:** No provider write APIs (refunds, transfers, payouts, captures, or payment mutations) were executed, enabled, or implemented. Razorpay integration remains strictly read-only.
- **Phase 5 Remains Locked:** No autonomous financial actions, background settlement polling schedulers, or automated lifecycle reversal loops have been started.
