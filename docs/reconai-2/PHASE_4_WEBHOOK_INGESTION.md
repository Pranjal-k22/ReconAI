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
  - `200 OK`: Event accepted (`ACCEPTED`), duplicate acknowledged (`DUPLICATE_ACKNOWLEDGED`), or safely quarantined (`QUARANTINED`). Controlled JSON response returned with `{ success: true, data: { status, eventId, isDuplicate } }`.
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
4. **Log Sanitization:** Sensitive payload fields (`password`, `token`, `secret`, `authorization`, `cookie`, `key`, `gemini_api_key`) are recursively redacted to `[REDACTED]` prior to audit logging or storage in `PaymentLifecycleEvent.normalizedPayload`.

---

## 4. Durable Event Identity & Idempotency

- **Primary Event Key:** Derived from header `X-Razorpay-Event-Id` when present:
  `deduplicationKey = "RAZORPAY:" + accountId + ":" + headerEventId`
- **Stable Fallback Key:** If `X-Razorpay-Event-Id` is absent from headers, a deterministic, provider-account-scoped SHA-256 fingerprint of the raw payload bytes is used:
  `deduplicationKey = "RAZORPAY_FALLBACK:" + accountId + ":" + sha256(rawBytes)`
- **MongoDB Unique Index:** Enforced via `PaymentLifecycleEvent.schema`:
  `deduplicationKey: { type: String, required: true, unique: true, index: true }`
- **Duplicate Race Handling:**
  Concurrent deliveries of the same event catch MongoDB duplicate-key errors (`err.code === 11000` or `E11000`) and return an idempotent acknowledgement:
  `{ success: true, data: { status: "DUPLICATE_ACKNOWLEDGED", isDuplicate: true, eventId } }`
  This ensures zero duplicate database records and zero double-processing side effects under extreme concurrency.
- **Audit Logging:** Every duplicate delivery triggers a `WEBHOOK_DUPLICATE_SKIPPED` audit entry.

---

## 5. Replay, Out-of-Order Safety & Canonical State Progression

1. **Timestamp Headers:** Official Razorpay webhooks do not support custom timestamp headers (such as Stripe's `t=` header). Delivery time is derived from the signed envelope's `created_at` field (seconds since UNIX epoch), while `ingestedAt` records local ingestion time. No artificial freshness windows are enforced that would reject valid provider retries over their 24-hour retry window.
2. **Terminal State Progression Guards:**
   Gateway payment status transitions are strictly governed by `canTransitionGatewayStatus`:
   - `CAPTURED` can transition only to `REFUNDED` or `PARTIALLY_REFUNDED`. It cannot regress to `AUTHORIZED`, `FAILED`, or `CREATED`.
   - `REFUNDED` is terminal and cannot transition to any other status.
   - `FAILED` is terminal and cannot regress or transition.
   - Out-of-order delivery of a delayed `payment.failed` event for a previously `CAPTURED` payment is durably recorded in `PaymentLifecycleEvent` but log-warned and prevented from mutating the canonical `GatewayPayment` status.
3. **PaymentCase Orthogonal Dimension Safety:**
   `PaymentCase.captureStatus` updates safely: if already `CAPTURE_CAPTURED`, delayed `payment.authorized` or `payment.failed` webhooks are prevented from regressing `captureStatus`.

---

## 6. Correlation, Tenant Isolation & Quarantining

- **Tenant Resolution:** The event's tenant identity is derived from:
  1. `payload.payment.entity.notes.tenantId`
  2. Matching `MerchantOrder.tenantId` (correlated via `order_id`)
  3. Matching `GatewayPayment.tenantId` (correlated via `gatewayPaymentId`)
- **Cross-Tenant Spoofing Prevention:** If `notes.tenantId` claims Tenant A, but the referenced `merchantOrderId` belongs to Tenant B, a cross-tenant security alert is triggered:
  - An `ACCESS_DENIED_ALERT` audit log entry is recorded with full provenance.
  - The event is durably recorded as `QUARANTINED` with `provenance.status = "QUARANTINED_CROSS_TENANT_MISMATCH"`.
  - Canonical orders or payments of Tenant B are never touched or exposed.
- **Unmatched Tenant:** Events lacking any identifiable tenant linkage are quarantined with `QUARANTINED_UNRESOLVED_TENANT`.
- **Unsupported Event Types:** Validly signed webhook events for unhandled provider features (e.g. `subscription.charged`, `virtual_account.credited`) are durably stored for audit and investigation with status `QUARANTINED_UNSUPPORTED_EVENT_TYPE`, without mutating payment or case ledgers.

---

## 7. Automated Test Verification Summary

| Test Suite | File Path | Test Count | Result |
|------------|-----------|------------|--------|
| Webhook Signatures & Middleware | `server/tests/webhook/webhookSignature.test.js` | 9 | PASS |
| Webhook Ingestion, Deduplication, Replay & Correlation | `server/tests/webhook/webhookIngestion.test.js` | 10 | PASS |
| Real MongoDB Webhook Persistence Integration | `server/tests/integration/webhookPersistence.integration.test.js` | 5 | PASS |
| Real MongoDB Service Persistence Integration | `server/tests/integration/servicePersistence.integration.test.js` | 10 | PASS |
| Full Backend Unit Test Suite | `npm test` across all 53 test files | 323 | PASS |
| Synthetic Reconciliation Benchmark | `tests/reconciliation/benchmarkCompatibility.test.js` | 120 / 120 | 100.00% MATCH |
| Frontend Production Build | `npm run build` in `client/` | 1 | PASS |

---

## 8. Safety & Compliance Confirmation

- **Zero Financial Writes:** No provider write APIs (refunds, transfers, payouts, captures, or payment creation) are executed or enabled. All Razorpay integrations remain read-only.
- **Phase 5 Not Started:** No settlement polling scheduler, automated state machine transitions, or automated financial action workers have been initialized. Phase 4 is strictly confined to provider-event ingestion, signature verification, and idempotency.
