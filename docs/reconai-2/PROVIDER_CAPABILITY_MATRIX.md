# ReconAI 2.0 — Payment Provider Capability & Safety Boundary Matrix

> **DOCUMENT STATUS: PROPOSED — AWAITING OWNER REVIEW**  
> *This document defines the payment provider integration boundaries, operational execution modes, security configurations, and API capability mappings for ReconAI 2.0. No application code has been modified.*

---

## 1. Multi-Tier Operational Execution Modes

To ensure strict financial safety, ReconAI 2.0 architecture decouples provider capabilities into **Four Isolated Operational Modes**. Live financial execution is disabled by default:

```text
┌────────────────────────────────────────────────────────────────────────┐
│               RECONAI 2.0 PROVIDER OPERATIONAL MODES                   │
├────────────────────┬───────────────────────────────────────────────────┤
│ Mode 1: INGEST_ONLY│ Read-only HTTP GET polling. Zero write capability.│
│ Mode 2: SIMULATED  │ Dry-run autonomous decisions. Zero external calls.│
│ Mode 3: SANDBOX    │ Autonomous execution using Razorpay Test Keys.    │
│ Mode 4: LIVE       │ DISABLED BY DEFAULT. Requires multi-party sign-off│
└────────────────────┴───────────────────────────────────────────────────┘
```

### Mode 1: Read-Only Ingestion Mode (`INGEST_ONLY`)
- **Status**: **VERIFIED & OPERATIONAL** (Current baseline).
- **Behavior**: Queries Razorpay payments and settlements using existing `razorpayClient.js`.
- **Safety Boundary**: Blocked from modifying provider or local accounting records.

### Mode 2: Simulated / Dry-Run Resolution Mode (`SIMULATED`)
- **Status**: **PROPOSED FOR PHASE 2 IMPLEMENTATION**.
- **Behavior**: Evaluates full autonomous resolution pipeline (Monitoring $\rightarrow$ Investigation $\rightarrow$ Policy Engine). Calculates idempotency keys, generates refund payloads, but records action as `SIMULATED_EXECUTION` without invoking external network endpoints.
- **Purpose**: Enables testing full multi-agent autonomous loops without external network dependencies.

### Mode 3: Sandbox / Test-Mode Write Operations (`SANDBOX`)
- **Status**: **IMPLEMENTED & HARDENED IN STAGE 3 (`razorpaySandboxAdapter.js`)**.
- **Behavior**: Executes write mutations (full refunds) against Razorpay Test Mode API (`https://api.razorpay.com/v1/...`) using valid `rzp_test_...` credentials.
- **Safety Boundary**: Hardcoded safety guard blocks any key beginning with `rzp_live_`. Writes are disabled by default via `RAZORPAY_SANDBOX_WRITES_ENABLED=false`. Execution strictly requires a signed Gate 3 `PolicyAuthorizationToken` (HMAC-SHA256, 120s TTL), server-derived dispatch evidence and idempotency key, authoritative fresh preflight GET read, atomic refund reservation (`reserveRefund`), and fail-closed policy limits. Autonomous worker refunds are prohibited.

### Mode 4: Live-Mode Write Operations (`LIVE`)
- **Status**: **STRICTLY BLOCKED & PROHIBITED**.
- **Safety Boundary**: Cannot be enabled via simple environment flag. Requires dual administrative approval, multi-signature configuration, and formal owner authorization.

---

## 2. Razorpay API Capability & Endpoint Matrix

| Operation / Capability | Target Endpoint | HTTP Method | Implementation Status in ReconAI | Supported Execution Mode | Idempotency Header Supported |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Fetch Payments List** | `/v1/payments` | `GET` | **Verified Supported** | `INGEST_ONLY`, `SANDBOX` | N/A |
| **Fetch Payment Details** | `/v1/payments/:id` | `GET` | **Verified Supported** | `INGEST_ONLY`, `SANDBOX` | N/A |
| **Fetch Settlements Recon** | `/v1/settlements/recon/combined` | `GET` | **Verified Supported** | `INGEST_ONLY`, `SANDBOX` | N/A |
| **Capture Payment** | `/v1/payments/:id/capture` | `POST` | Proposed Write Adapter (Deferred) | `SIMULATED` | `X-Razorpay-Idempotency-Key` |
| **Create Full Refund** | `/v1/payments/:id/refund` | `POST` | **Hardened Sandbox Adapter** (`razorpaySandboxAdapter.js`) | `SANDBOX` (Default Off; Token Required) | `X-Refund-Idempotency` |
| **Create Partial Refund** | `/v1/payments/:id/refund` | `POST` | Deferred / Blocked (Full balance refunds only in Stage 3) | N/A | `X-Refund-Idempotency` |
| **Fetch Refund Details** | `/v1/payments/:id/refunds/:rfd_id` | `GET` | **Verified Supported** | `INGEST_ONLY`, `SANDBOX` | N/A |
| **List Payment Refunds** | `/v1/payments/:id/refunds` | `GET` | **Verified Supported** (Preflight & Reconcile) | `INGEST_ONLY`, `SANDBOX` | N/A |
| **Receive Webhook Stream** | `/api/webhooks/razorpay` | `POST` | Proposed Ingestion Engine | All Modes | Verified via HMAC Header |
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
       
     return crypto.timingSafeEqual(
       Buffer.from(expectedSignature, "utf8"),
       Buffer.from(signature, "utf8")
     );
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
