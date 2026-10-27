# ReconAI 2.0 — Payment Provider Capability & Safety Boundary Matrix

> **DOCUMENT STATUS: IMPLEMENTED & VERIFIED (TEST MODE / READ-ONLY INGESTION)**<br/>
> *This document defines the payment provider integration boundaries, operational execution modes, security configurations, and API capability mappings for ReconAI 2.0 based on verified implementation.*

---

## 1. Provider Modes, Environments & Execution Authority

In ReconAI 2.0, provider execution authority is governed by three orthogonal dimensions:
1. **Provider Environment (`RAZORPAY_MODE`)**: Runtime configures `test` mode. Live credentials (`rzp_live_`) are hardcoded to throw immediate security exceptions.
2. **Provider Write Permission (`RAZORPAY_SANDBOX_WRITES_ENABLED`)**: Defaults to `false`. When false, any write attempt is immediately rejected with zero network traffic and zero database mutations.
3. **Execution Operation Status**: Provider operations follow strict lifecycle states: `REQUESTED`, `OUTCOME_UNKNOWN`, `VERIFIED_SUCCEEDED`, `VERIFIED_FAILED`, `SAFE_HOLD`.

Conceptual descriptors used in architectural docs map to code as follows:
- `INGEST_ONLY` / Read-Only Ingestion: Standard `razorpayClient.js` GET queries. Verified active.
- `SIMULATED` / Dry-Run: Evaluated by `dryRunSimulatorService.js`. Computes recommendations and idempotency keys with zero external API calls.
- `SANDBOX` / Test Mode: Guarded write adapter (`razorpaySandboxAdapter.js`) using `rzp_test_` keys. Enabled only when `RAZORPAY_SANDBOX_WRITES_ENABLED=true` and invoked by authenticated human `ADMIN` with Gate 3 `PolicyAuthorizationToken`.
- `LIVE`: Strictly prohibited. Live writes are not implemented or authorized.

---

## 2. Razorpay API Capability & Endpoint Matrix

| Operation / Capability | Target Endpoint | HTTP Method | Implementation Status in ReconAI | Supported Execution Mode | Idempotency Header Supported |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Fetch Payments List** | `/v1/payments` | `GET` | **Verified Supported** | `INGEST_ONLY`, `SANDBOX` | N/A |
| **Fetch Payment Details** | `/v1/payments/:id` | `GET` | **Verified Supported** | `INGEST_ONLY`, `SANDBOX` | N/A |
| **Fetch Settlements Recon** | `/v1/settlements/recon/combined` | `GET` | **Verified Supported** | `INGEST_ONLY`, `SANDBOX` | N/A |
| **Capture Payment** | `/v1/payments/:id/capture` | `POST` | Deferred (Auto-capture via checkout preferred) | `SIMULATED` | `X-Razorpay-Idempotency-Key` |
| **Create Full Refund** | `/v1/payments/:id/refund` | `POST` | **Hardened Sandbox Adapter** (`razorpaySandboxAdapter.js`) | `SANDBOX` (Default Off; Token Required) | `X-Refund-Idempotency` |
| **Create Partial Refund** | `/v1/payments/:id/refund` | `POST` | Deferred / Blocked (Full balance refunds only in Stage 3) | N/A | `X-Refund-Idempotency` |
| **Fetch Refund Details** | `/v1/payments/:id/refunds/:rfd_id` | `GET` | **Verified Supported** | `INGEST_ONLY`, `SANDBOX` | N/A |
| **List Payment Refunds** | `/v1/payments/:id/refunds` | `GET` | **Verified Supported** (Preflight & Reconcile) | `INGEST_ONLY`, `SANDBOX` | N/A |
| **Receive Webhook Stream** | `/api/webhooks/razorpay` | `POST` | **Verified Implemented** (`webhookService.js`) | All Modes | Verified via HMAC Header |
| **Fetch Disputes List** | `/v1/disputes` | `GET` | Proposed Read Adapter | `INGEST_ONLY`, `SANDBOX` | N/A |
| **Direct Bank UTR Reversal Query** | Partner Bank API | `POST/GET` | Unsupported (3rd Party Bank Dependent) | N/A | Requires Direct Bank Tie-Up |


---

## 3. Cryptographic Webhook Security Specification

Adhering to Razorpay's official security recommendations:
1. **Webhook Endpoint Path**: `POST /api/webhooks/razorpay`
2. **Secret Key Configuration**: Managed via environment variable `RAZORPAY_WEBHOOK_SECRET` (never logged or exposed).
3. **Signature Verification Algorithm**:
   ```javascript
   import crypto from "crypto";
   
   export function verifyRazorpayWebhookSignature({ rawBodyBuffer, signature, secret }) {
     if (!rawBodyBuffer || !signature || !secret) return false;
     
     const expectedSignature = crypto
       .createHmac("sha256", secret)
       .update(rawBodyBuffer)
       .digest("hex");
       
     // Length check prevents timingSafeEqual from throwing on mismatched lengths
    const sigBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, sigBuffer);
   }
   ```
4. **Body Parsing Invariant**: Express middleware must capture the raw `req.rawBody` buffer **before** `express.json()` parses the stream into an object. Failure to do so alters whitespace and breaks HMAC signature verification.

---

## 4. Razorpay Security Checklist Compliance Matrix

| Security Recommendation (Razorpay Official Checklist) | ReconAI 2.0 Implementation Strategy | Compliance Status |
| :--- | :--- | :---: |
| **Validate Webhook Authenticity with HMAC** | Cryptographic raw-buffer HMAC-SHA256 signature verification in middleware. | Proposed in Phase 1; Phase 2 Target |
| **Do Not Trust Client-Side Redirect State** | Server-side GET `/v1/payments/:id` verification before order fulfillment or refund. | Proposed in Phase 1; Phase 2 Target |
| **Use Idempotency Keys on Financial Writes** | Unique `X-Razorpay-Idempotency-Key` generated and enforced on every write call. | Proposed in Phase 1; Phase 2 Target |
| **Enforce Least Privilege & RBAC Roles** | 7 granular architectural roles with tenant scoping and row-level filtering. | Proposed in Phase 1; Phase 2 Target |
| **Restrict Dashboard Access & Enable 2FA** | Admin console guarded by JWT + multi-factor session validation. | Proposed in Phase 1; Phase 2 Target |
| **Redact Sensitive Credentials & Secrets** | Automatic recursive scrubbing of keys and authorization headers to `[REDACTED]`. | **Verified Active** (`auditService.js`) |
| **Strip Customer PII Before Storage** | Email, phone, card payload, and VPA automatically removed prior to MongoDB save. | **Verified Active** (`razorpayNormalizer.js`) |
