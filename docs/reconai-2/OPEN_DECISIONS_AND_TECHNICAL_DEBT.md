# ReconAI 2.0 — Open Decisions, Safety Blockers & Technical Debt Register

> **DOCUMENT BASELINE**: `main` branch @ commit `fa3357bb6afd36f4396695baad524e8dd6ee3e8c`  
> **AUDIT TIMESTAMP**: October 26, 2026  
> **CANONICAL SCOPE**: Central authority tracking all unresolved owner decisions, architectural safety blockers, technical debt, and priority implementation gaps for ReconAI 2.0.

---

## 1. Owner Decisions Required

The following decisions require explicit product, financial-policy, risk, or architectural direction from project leadership before further development:

### OD-01: Cumulative Daily Refund Aggregation (`maxCumulativeRefundPaise`)
- **Category**: Financial Policy / Policy Limits Engine
- **Current Code Reality**:
  - In `server/src/services/policy/resolutionPolicyEvaluator.js`, Guard 7 evaluates `maxSingleRefundPaise` and Guard 8 evaluates `maxCumulativeRefundPaise`.
  - However, `currentCumulativeDailyPaise` is hardcoded to `0` because historical transaction-level refund aggregation across transactions for the active business day has not been implemented.
  - In `server/tests/policy/limitSemanticsTruth.test.js`, tests prove that whenever an operation exceeds `maxCumulativeRefundPaise`, it also exceeds `maxSingleRefundPaise` if single limit is lower, or Guard 8 fails to trigger dynamically against real historical spend.
- **Tradeoff**:
  - *Option A*: Implement a performant Mongo aggregation pipeline over `ProviderOperation` and `PaymentAction` to compute true historical 24-hour refund spend per tenant.
  - *Option B*: Deprecate `maxCumulativeRefundPaise` in policy configuration schema v2 and rely strictly on per-transaction `maxSingleRefundPaise` until multi-currency ledger aggregation is designed.
- **Recommendation**: Implement Option A using indexed queries on `{ tenantId: 1, operationType: "REFUND", createdAt: { $gte: startOfDay } }`.

### OD-02: Stage 5B Precedence Reordering on Merged Inputs (52 Outcome Changes)
- **Category**: Classification Engine Precedence
- **Current Code Reality**:
  - As verified in ADR-14 and `classifierPrecedenceInvariant.test.js`, reordering the 41 classification rules to ensure all 22 safe-hold rules strictly precede all 19 non-safe-hold rules resulted in **0 differences on the 30 standalone scenario fixtures**, but changed **52 outcomes on merged/overlapping fixtures**.
  - Out of 155 evaluated merged pairs, 52 differences were observed (49 transitioned from not-held to held, 3 transitioned from held to held due to Tier 3 precedence, 0 transitioned from held to not-held).
  - Any classifications persisted prior to commit `ac18699` on synthetic merged inputs may reflect non-held outcomes.
- **Tradeoff**:
  - *Option A (Affirmed)*: Accept the 52 changed outcomes as the intended, fail-closed behavior of the system (safety-first invariant).
  - *Option B*: Introduce rule-specific exceptions allowing certain non-safe-hold repairs to execute despite co-occurring anomalies.
- **Recommendation**: Confirm Option A as canonical policy: any ambiguity or co-occurring anomaly must trigger `CASE_SAFE_HOLD`.

### OD-03: Case 22 Manual Resolution Workflow & Authorization Model
- **Category**: Financial Safety / Operational Workflow
- **Current Code Reality**:
  - The non-negotiable invariant for Case 22 (`LATE_CAPTURE_CANCELLED_ORDER`) is: **Must remain in Safe Hold, with no automatic refund and no automatic reopening of the cancelled order.**
  - Currently, Case 22 cases transition to `CASE_SAFE_HOLD` (`safeHoldCode: "LATE_CAPTURE_CANCELLED_ORDER"`).
  - There is zero backend API route or frontend workflow to manually resolve or release a Case 22 hold.
- **Tradeoff**:
  - What authorization model governs releasing Case 22? (Single ADMIN override vs two-person approval with merchant acknowledgment).
  - Should the operator choose between: (a) forcing a refund via provider, (b) un-cancelling and fulfilling the order in merchant ERP, or (c) issuing store credit?
- **Recommendation**: Require dual-admin authorization (`ADMIN_APPROVER !== ADMIN_INITIATOR`) with mandatory reason logging before executing any manual resolution on Case 22.

### OD-04: Customer Claim Intake Route Architecture
- **Category**: Ingestion & Evidence Collection
- **Current Code Reality**:
  - Edge Cases 2 (`CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING`), 3 (`CUSTOMER_DEBIT_CLAIM_PAYMENT_FAILED`), and 29 (`FRAUD_ALLEGATION_UNAUTHORIZED_PAYMENT`) are categorized as `NEEDS_CLAIM_INTAKE`.
  - No public or customer-facing claim intake endpoints (`POST /api/claims`) exist in `server/src/routes`.
- **Decision Required**:
  - Define authentication, rate limiting, and CAPTCHA requirements for consumer claim submission.
  - Determine whether bank account statements / UPI screenshots can be uploaded and where binary assets are stored (S3 vs local gridfs).

### OD-05: Live Provider Write Activation Policy
- **Category**: Production Security & Compliance
- **Current Code Reality**:
  - Sandbox writes are disabled by default (`RAZORPAY_SANDBOX_WRITES_ENABLED=false`).
  - Production live writes are completely prohibited (`rzp_live_` keys throw immediate startup exceptions).
- **Decision Required**:
  - Establish the multi-signature protocol, regulatory compliance review, and legal indemnity agreements required before live financial write capabilities can be enabled.

---

## 2. Safety Blockers & Open Technical Gaps

The following issues represent functional or architectural gaps identified during the audit:

| # | Item | Status | Subsystem | Description & Impact |
|---|---|---|---|---|
| **GAP-01** | **Admin Two-Factor Authentication (2FA)** | `UNIMPLEMENTED / PROPOSED` | Auth / Security | Documentation states ADMIN requires 2FA; however, authentication uses standard username/password with scrypt hashing. Zero TOTP, SMS, or WebAuthn code exists in `server/src`. |
| **GAP-02** | **Mutual TLS (mTLS) for Machine Services** | `UNIMPLEMENTED / PROPOSED` | Transport Security | Documentation previously claimed mTLS was active; actual transport uses Bearer JWT (`aud: reconai-service`) or `x-service-token` over standard HTTPS. No client certificate validation exists in code. |
| **GAP-03** | **Dispute Webhook Pipeline** | `UNIMPLEMENTED` | Ingestion / Webhooks | Case 30 (`CHARGEBACK_OR_FORMAL_DISPUTE`) relies on dispute fields on `GatewayPayment`, but `webhookService.js` only handles `payment.*` and `settlement.*` events. Razorpay `dispute.created`, `dispute.won`, `dispute.lost` are not ingested. |
| **GAP-04** | **Unreachable Reserved Cases (18 & 23)** | `RESERVED / BLOCKED` | Classification | Upstream schema normalizers (`normalizationService.js`) reject conflicting payment records fail-closed, preventing Cases 18 (conflicting records) and 23 (ambiguous candidates) from reaching the classifier via standard ingestion. |
| **GAP-05** | **Split Capture Webhook Pipeline** | `SEEDABLE_ONLY` | Ingestion / Razorpay | Case 8 (`PARTIAL_CAPTURE`) schema fields (`amountAuthorizedPaise`, `amountCapturedPaise`) are implemented and test-seedable, but standard Razorpay webhook ingestion has zero production writers for partial captures. |
| **GAP-06** | **Precedence Rule Extractor Regex Fragility** | `TECHNICAL DEBT` | Testing / Classifier | `classifierPrecedenceInvariant.test.js` uses regex `/\/\/\s*Case\s+([^:\n]+)/` to parse rules. While protected by an independent `Function#toString` return branch counter check asserting 40 branches, omitting comments in future rules could desynchronize rule documentation. |
| **GAP-07** | **Operator Workspace Admin Tenant Selector** | `PROPOSED` | Frontend Client | In Stage 6B, `ADMIN` views all tenant records without an explicit tenant filter dropdown in the UI. Tenant switching is controlled via API token claims. |

---

## 3. Prioritized Engineering Roadmap

### Priority 1: Security Hardening & Claim Ingestion (Immediate)
1. **Implement Admin 2FA (TOTP)**: Integrate `@levminer/speakeasy` or standard TOTP RFC 6238 into `server/src/routes/authRoutes.js` for `ADMIN` role.
2. **Customer Claim Intake API**: Implement `POST /api/claims` with Zod validation, rate limiting, and tenant scoping to activate Cases 2, 3, and 29.
3. **Dispute Webhook Handlers**: Add handlers for `dispute.created`, `dispute.under_review`, `dispute.won`, and `dispute.lost` to `webhookService.js`.

### Priority 2: Policy Limits & Case 22 Resolution (Medium Term)
4. **Historical Cumulative Daily Refund Aggregator**: Replace hardcoded 0 with Mongo aggregation over 24-hour tenant refund activity.
5. **Case 22 Dual-Admin Resolution Flow**: Build backend endpoints and operator UI for controlled, auditable manual release of Case 22 Safe Holds.
6. **Admin Tenant Switcher**: Add tenant selection dropdown to Operator Workspace header for `ADMIN` users.

### Priority 3: Enterprise Integration (Longer Term)
7. **Mutual TLS Termination**: Configure reverse proxy (Nginx / Cloudflare / Envoy) client certificate validation for machine service tokens.
8. **Direct Bank UPI RRN Inquiry Adapter**: Connect to partner bank APIs for authoritative UTR/RRN settlement queries beyond Razorpay's boundary.
