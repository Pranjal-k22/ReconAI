# ReconAI 2.0 — Complete Edge-Case Policy & Resolution Matrix (30 Scenarios)

> **DOCUMENT STATUS: PROPOSED — AWAITING OWNER REVIEW**  
> *This document provides the definitive policy specifications, authoritative evidence requirements, autonomous eligibility rules, and test criteria for all 30 payment edge cases in ReconAI 2.0. 30 deterministic rules are implemented in the engine. Reachability is evaluated via runtime proxy tracing and DB-driven classification (Stage 5 Part B). There is no claim that all 30 scenarios are supported end to end without intake routes.*

---

## 1. Governance Principles for Autonomous Financial Actions

Every autonomous action evaluated by ReconAI 2.0 must satisfy four foundational safety rules:
1. **Rule of Positive Evidence**: No action (refund or credit) may execute on the *absence* of evidence. Actions require cryptographically validated positive evidence from authoritative sources.
2. **Rule of Policy Supremacy**: Recommendations from AI agents (Investigator, Planner) are advisory. Only the server-side deterministic Policy Engine holds execution authority.
3. **Rule of Single Mutation (Idempotency)**: Every financial mutation must possess a globally unique, deterministic idempotency key and an active concurrency lock lease before dispatch.
4. **Rule of Safe Containment**: When evidence is conflicting, ambiguous, or exceeds risk thresholds, the system must transition the case to `SAFE_HOLD` rather than guessing.

---

## 1.1. Proven Reachability Summary (Stage 5.6 Code-Computed)

Reachability is determined strictly by runtime proxy tracing and DB-driven classification (Stage 5.6). Cases are categorized strictly based on whether decisive fields have production writers (excluding legacy CSV import and sandbox-only dispatch):

| Category | Count | Cases | Notes / Enforcement Point |
|:---|:---:|:---|:---|
| **PROVEN_END_TO_END** | 8 | 5, 6, 7, 17, 19, 20, 21, 22 | Webhook / API poller writes all decisive fields in production |
| **SEEDABLE_ONLY** | 6 | 8, 10, 11, 12, 26, 30 | Schema supports fields; test-seedable; zero production webhook writers |
| **INGESTION_TIME** | 5 | 13, 14, 15, 16, 28 | Handled at ingestion/network boundary (`webhookService.js`, `authMiddleware.js`) |
| **NEEDS_CLAIM_INTAKE** | 3 | 2, 3, 29 | Requires customer claim-intake endpoints not yet implemented |
| **RESERVED** | 6 | 1, 4, 9, 18, 23, 27 | Reserved pending authoritative data sources or runtime concurrency locks |
| **NO_SOURCE** | 2 | 24, 25 | Infrastructure runtime faults not persisted in transactional records |
| **Total** | 30 | | Evaluated across all 30 scenario rules |

---

## 2. Comprehensive 30 Edge-Case Policy Specifications

---

### Case 1: Frontend Timeout After Payment Success [RESERVED]
> **Status**: **Reserved: requires a server-verified telemetry source, not counted as a supported scenario** (no code change).
- **Detection Signal**: Browser disconnects or checkout times out; merchant order remains `ORDER_PENDING`.
- **Authoritative Evidence**: Provider webhook `payment.captured` or server GET `/v1/payments/:id` confirms `status === 'CAPTURED'`, **AND** authenticated client checkout telemetry records an explicit session drop/timeout event.
- **Missing / Uncertain Evidence**: Authenticated client checkout telemetry is unobserved in standard gateway integration. Without cryptographic client telemetry, timeout causation cannot be inferred.
- **Autonomous Action Eligibility**: **RESERVED / NOT COUNTED AS A SUPPORTED SCENARIO**. If frontend telemetry is unobserved, system strictly avoids causal inference and classifies as `CASE_6_PAID_GATEWAY_UNPAID_ORDER` (`STATUS_MISMATCH`).
- **Required Verification**: Direct server-verified client session telemetry.
- **Retry / Monitoring Policy**: Poll provider if webhook not received within 60s of timeout.
- **Duplicate-Action Protections**: Order state transition check (`if order.status === 'PAID'` $\rightarrow$ no-op).
- **Safe-Hold / Escalation Condition**: Order already cancelled by merchant before payment arrived.
- **Customer Notification**: *"Your payment of ₹X was verified successfully. Order confirmed."*
- **Audit Event Requirements**: `MERCHANT_LEDGER_REPAIRED`, `CASE_RESOLVED`.
- **Test Acceptance Criterion**: Without authenticated client telemetry, scenario is classified as `STATUS_MISMATCH` (Case 6) rather than Case 1.
- **Policy Contradiction Documentation**: *The original Phase 1 title asserted causation ('Frontend Timeout') based solely on provider capture and local order pending, while listing frontend acknowledgment as unobserved. Under strict ReconAI evidence governance, causation cannot be inferred from two records being inconsistent. Case 1 is reserved pending an authenticated telemetry source.*

---

### Case 2: Customer Debit Claim with Gateway Pending
- **Detection Signal**: Customer submits claim via Customer AI; Gateway payment status is `PENDING`.
- **Authoritative Evidence**: Customer claim intake; Gateway GET confirms `status === 'PENDING'`.
- **Missing / Uncertain Evidence**: Final bank clearance or drop-off confirmation.
- **Autonomous Action Eligibility**: **NOT ELIGIBLE FOR REFUND OR CREDIT**. Eligible for `WAIT_AND_MONITOR`.
- **Required Verification**: Re-verify provider state at scheduled intervals.
- **Retry / Monitoring Policy**: Background worker schedules checks at $T+1\text{m}, T+5\text{m}, T+15\text{m}, T+30\text{m}$.
- **Duplicate-Action Protections**: Active monitoring lock prevents duplicate claim cases.
- **Safe-Hold / Escalation Condition**: Payment remains `PENDING` after $T+60\text{ minutes}$.
- **Customer Notification**: *"Your payment is currently being processed by your bank. We are monitoring it automatically."*
- **Audit Event Requirements**: `CLAIM_REGISTERED`, `MONITORING_SCHEDULED`.
- **Test Acceptance Criterion**: Claim with pending gateway state triggers automated polling, zero refunds issued.

---

### Case 3: Customer Debit Claim with Payment Failed
- **Detection Signal**: Gateway payment transitions to `FAILED`; customer debited or claims deduction.
- **Authoritative Evidence**: Gateway `status === 'FAILED'` with failure error code; Customer debit proof.
- **Missing / Uncertain Evidence**: Automatic bank reversal status.
- **Autonomous Action Eligibility**: **ELIGIBLE** for `REFUND_CUSTOMER` or `TRACK_AUTO_REVERSAL`.
- **Required Verification**: Merchant order is unpaid/cancelled; RBI Harmonisation framework TAT applies.
- **Retry / Monitoring Policy**: Query provider refund/reversal status every 4 hours for 24 hours.
- **Duplicate-Action Protections**: Unique idempotency key `IDEM-REF-{paymentId}`.
- **Safe-Hold / Escalation Condition**: Reversal not confirmed within statutory $T+1$ (UPI) or $T+5$ (Card) window.
- **Customer Notification**: *"Your transaction failed. A full refund has been tracked/initiated per RBI guidelines."*
- **Audit Event Requirements**: `AUTO_REVERSAL_TRACKED`, `REFUND_INITIATED`, `CASE_RESOLVED`.
- **Test Acceptance Criterion**: Failed payment with debit claim initiates verified refund or tracks reversal to closure.

---

### Case 4: Late Authorization After Timeout
- **Detection Signal**: Payment was marked timed out, but webhook `payment.authorized` arrives 15 minutes later.
- **Authoritative Evidence**: Cryptographic webhook `payment.authorized` with valid timestamp.
- **Missing / Uncertain Evidence**: Merchant inventory availability.
- **Autonomous Action Eligibility**: **ELIGIBLE** for `AUTO_CAPTURE` (if inventory available). For uncaptured payments where inventory is unavailable, note Razorpay provider limitation:
  > **Razorpay API Capability Finding (B5)**: Razorpay does **not** provide a direct void API for authorized uncaptured payments (`POST /v1/payments/:id/refund` fails if uncaptured; no `/v1/payments/:id/void` exists). Authorized uncaptured payments automatically refund (auto-void) after 3 days per official Razorpay documentation. Direct refunds cannot be called on uncaptured payments (`BAD_REQUEST_ERROR: This payment has not been captured yet`). The system must not artificially capture unfulfilled payments solely to issue refunds; instead, allow the authorization to lapse/auto-refund after 3 days or hold for manual review.
- **Required Verification**: Shop AI confirms inventory status.
- **Retry / Monitoring Policy**: Verify order status before capture.
- **Duplicate-Action Protections**: Check authorization expiry date and capture lock.
- **Safe-Hold / Escalation Condition**: Inventory unavailable and auto-void window exceeds merchant risk tolerance $\rightarrow$ `SAFE_HOLD`.
- **Customer Notification**: *"Your late payment was verified. [Order confirmed / Authorization will lapse]."*
- **Audit Event Requirements**: `LATE_AUTHORIZATION_RESOLVED`.
- **Test Acceptance Criterion**: Late authorization triggers inventory check; uncaptured payments cannot be directly refunded via refund API.

---

### Case 5: Captured Payment with Delayed Merchant Settlement
- **Detection Signal**: Batch reconciliation flags `MISSING_SETTLEMENT` after 24 hours.
- **Authoritative Evidence**: Gateway `CAPTURED`; settlement record missing in bank batch.
- **Missing / Uncertain Evidence**: Bank payout NEFT UTR.
- **Autonomous Action Eligibility**: **NOT ELIGIBLE FOR REFUND**. Eligible for `WAIT_FOR_SETTLEMENT`.
- **Required Verification**: Current time is within standard $T+2$ bank settlement window.
- **Retry / Monitoring Policy**: Poll settlement recon report at $T+24\text{h}$ and $T+48\text{h}$.
- **Duplicate-Action Protections**: Prevent customer refund when payment is legitimately captured.
- **Safe-Hold / Escalation Condition**: Settlement missing past $T+72\text{ hours}$.
- **Customer Notification**: Customer is unaffected (Order remains paid). Shop notified of settlement timeline.
- **Audit Event Requirements**: `SETTLEMENT_MONITORING_ACTIVE`.
- **Test Acceptance Criterion**: Captured payment with pending settlement is monitored, never erroneously refunded.

---

### Case 6: Paid Gateway Payment But Unpaid Order
- **Detection Signal**: Reconciliation flags `STATUS_MISMATCH` (Gateway `CAPTURED`, Order `CREATED`/`PENDING`).
- **Authoritative Evidence**: Gateway payment record captured; merchant order status unpaid.
- **Missing / Uncertain Evidence**: None.
- **Autonomous Action Eligibility**: **ELIGIBLE** for `UPDATE_MERCHANT_LOCAL_LEDGER`.
- **Required Verification**: Exact amount match; exact currency match; single payment candidate.
- **Retry / Monitoring Policy**: Immediate execution upon policy pass.
- **Duplicate-Action Protections**: Verify order is not already marked paid.
- **Safe-Hold / Escalation Condition**: Order cancelled or refunded prior to payment.
- **Customer Notification**: *"Your order has been verified and confirmed."*
- **Audit Event Requirements**: `MERCHANT_LEDGER_REPAIRED`, `CASE_RESOLVED`.
- **Test Acceptance Criterion**: Discrepancy automatically repairs merchant order to `PAID`.

---

### Case 7: Duplicate Payment Attempts
- **Detection Signal**: Reconciliation flags `DUPLICATE_PAYMENT` (2 captured payments for 1 order ID).
- **Authoritative Evidence**: Gateway records show 2 distinct `gatewayPaymentId`s for identical `merchantOrderId`.
- **Missing / Uncertain Evidence**: Merchant willingness to fulfill duplicate goods.
- **Autonomous Action Eligibility**: **ELIGIBLE** for `REFUND_DUPLICATE_PAYMENT`.
- **Required Verification**: Shop AI confirms single order fulfillment; second payment is identical amount.
- **Retry / Monitoring Policy**: Refund the second payment using its distinct ID.
- **Duplicate-Action Protections**: Strict single-refund lock; ensure primary payment remains untouched.
- **Safe-Hold / Escalation Condition**: Payments have different amounts or order allows multi-quantity.
- **Customer Notification**: *"We detected an accidental duplicate payment. The extra ₹X has been refunded."*
- **Audit Event Requirements**: `DUPLICATE_PAYMENT_REFUNDED`, `CASE_RESOLVED`.
- **Test Acceptance Criterion**: Identifies duplicate payment candidate and executes exactly one refund on the second payment.

---

### Case 8: Partial Capture [SEEDABLE_ONLY in Stage 5: Schema Added in Part B; Zero Production Ingestion Writers]
- **Detection Signal**: Gateway `amount_captured < amount_authorized` (Not present in documented standard entity).
- **Authoritative Evidence**: Provider payment record with split capture fields.
- **Missing / Uncertain Evidence**: Merchant partial fulfillment terms.
- **Autonomous Action Eligibility**: **NOT ELIGIBLE FOR AUTONOMOUS ACTION**.
- **Required Verification**: Requires merchant business contract review.
- **Retry / Monitoring Policy**: None.
- **Duplicate-Action Protections**: N/A.
- **Safe-Hold / Escalation Condition**: **IMMEDIATE SAFE_HOLD**.
- **Customer Notification**: *"Your payment underwent partial capture. Our finance team is reviewing your balance."*
- **Audit Event Requirements**: `SAFE_HOLD_PARTIAL_CAPTURE`.
- **Test Acceptance Criterion**: Partial capture triggers immediate transition to `SAFE_HOLD`.

---

### Case 9: Partial Payment
- **Detection Signal**: Customer paid ₹1,000 for an order totaling ₹2,000.
- **Authoritative Evidence**: Order amount ₹2,000; Gateway payment ₹1,000.
- **Missing / Uncertain Evidence**: Whether merchant supports layaway / partial installments.
- **Autonomous Action Eligibility**: **NOT ELIGIBLE FOR AUTONOMOUS REFUND**.
- **Required Verification**: Check if split payment policy is enabled for merchant.
- **Retry / Monitoring Policy**: Wait 15 minutes for second payment installment.
- **Duplicate-Action Protections**: N/A.
- **Safe-Hold / Escalation Condition**: Second payment missing after window $\rightarrow$ `SAFE_HOLD`.
- **Customer Notification**: *"Partial payment received. Please complete the remaining balance of ₹X."*
- **Audit Event Requirements**: `PARTIAL_PAYMENT_FLAGGED`.
- **Test Acceptance Criterion**: Partial payment holds order in `PARTIALLY_PAID` without unauthorized refund.

---

### Case 10: Partial Refund
- **Detection Signal**: Gateway records `amount_refunded > 0` but `< amount_captured`.
- **Authoritative Evidence**: Webhook `refund.processed` with `amount_refunded` payload.
- **Missing / Uncertain Evidence**: Return item condition.
- **Autonomous Action Eligibility**: **ELIGIBLE** for `UPDATE_MERCHANT_LOCAL_LEDGER` (adjust balance).
- **Required Verification**: Net calculation matches merchant return slip.
- **Retry / Monitoring Policy**: Update local order refund metadata.
- **Duplicate-Action Protections**: Prevent double refunding remaining balance.
- **Safe-Hold / Escalation Condition**: Refund exceeds captured amount.
- **Customer Notification**: *"Partial refund of ₹X has been credited."*
- **Audit Event Requirements**: `PARTIAL_REFUND_RECORDED`.
- **Test Acceptance Criterion**: Net integer paise math correctly tracks partial refund balance.

---

### Case 11: Full Refund Initiated But Not Completed
- **Detection Signal**: Refund status remains `REFUND_PENDING` past standard bank processing window.
- **Authoritative Evidence**: Provider refund record has `status === 'pending'`.
- **Missing / Uncertain Evidence**: Acquiring bank clearance confirmation.
- **Autonomous Action Eligibility**: **NOT ELIGIBLE FOR NEW REFUND**. Eligible for `MONITOR_REFUND`.
- **Required Verification**: Recheck refund status via GET `/v1/refunds/:id`.
- **Retry / Monitoring Policy**: Background poll every 6 hours for 3 days.
- **Duplicate-Action Protections**: Strict block on re-submitting refund request.
- **Safe-Hold / Escalation Condition**: Refund pending past 7 business days.
- **Customer Notification**: *"Your refund is in progress with the banking network."*
- **Audit Event Requirements**: `REFUND_PROGRESS_POLL`.
- **Test Acceptance Criterion**: Prevents re-triggering refund when initial refund is still in flight.

---

### Case 12: Failed Refund
- **Detection Signal**: Webhook `refund.failed` received or GET query returns `status === 'failed'`.
- **Authoritative Evidence**: Provider refund error code (e.g., `card_issuer_declined`, `account_closed`).
- **Missing / Uncertain Evidence**: Alternate bank account for payout.
- **Autonomous Action Eligibility**: **NOT ELIGIBLE FOR AUTONOMOUS RETRY**.
- **Required Verification**: Capture failure reason from provider.
- **Retry / Monitoring Policy**: None.
- **Duplicate-Action Protections**: N/A.
- **Safe-Hold / Escalation Condition**: **IMMEDIATE SAFE_HOLD & ADMIN ESCALATION**.
- **Customer Notification**: *"Your refund could not be processed by your bank. Our support desk will contact you for alternate account details."*
- **Audit Event Requirements**: `REFUND_FAILED_ALERT`, `CASE_SAFE_HOLD`.
- **Test Acceptance Criterion**: Failed refund routes case to admin safe-hold queue.

---

### Case 13: Stale Event After Refund Completion
- **Detection Signal**: Old webhook `refund.created` arrives 2 hours after `refund.processed` already closed case.
- **Authoritative Evidence**: Existing case state `refundState === 'REFUND_CONFIRMED'`; event timestamp older.
- **Missing / Uncertain Evidence**: None.
- **Autonomous Action Eligibility**: **NO-OP**.
- **Required Verification**: Event timestamp comparison.
- **Retry / Monitoring Policy**: None.
- **Duplicate-Action Protections**: Monotonic state guard drops stale event.
- **Safe-Hold / Escalation Condition**: None.
- **Customer Notification**: None.
- **Audit Event Requirements**: `STALE_EVENT_DROPPED`.
- **Test Acceptance Criterion**: Out-of-order stale event causes zero state mutation or re-opening.

---

### Case 14: Duplicate Webhook Delivery
- **Detection Signal**: Gateway sends identical webhook event payload twice within seconds.
- **Authoritative Evidence**: Event ID matches existing record in `IngestedWebhookEvent`.
- **Missing / Uncertain Evidence**: None.
- **Autonomous Action Eligibility**: **NO-OP**.
- **Required Verification**: Compound unique index lookup on `eventId`.
- **Retry / Monitoring Policy**: Acknowledge with HTTP 200 immediately.
- **Duplicate-Action Protections**: Event deduplication ledger.
- **Safe-Hold / Escalation Condition**: None.
- **Customer Notification**: None.
- **Audit Event Requirements**: `DUPLICATE_WEBHOOK_ACKNOWLEDGED`.
- **Test Acceptance Criterion**: Duplicate webhook acknowledged with 200 and ignored.

---

### Case 15: Forged Webhook
- **Detection Signal**: Incoming POST to webhook route with invalid or missing HMAC signature.
- **Authoritative Evidence**: `crypto.timingSafeEqual` fails between header signature and calculated hash.
- **Missing / Uncertain Evidence**: None.
- **Autonomous Action Eligibility**: **REJECT & DROP**.
- **Required Verification**: HMAC-SHA256 over raw request buffer.
- **Retry / Monitoring Policy**: Return HTTP 400 Bad Request immediately.
- **Duplicate-Action Protections**: Zero processing permitted.
- **Safe-Hold / Escalation Condition**: Immediate security alert logged.
- **Customer Notification**: None.
- **Audit Event Requirements**: `WEBHOOK_SIGNATURE_VERIFICATION_FAILED`.
- **Test Acceptance Criterion**: Webhook with invalid signature rejected with 400; no database write.

---

### Case 16: Out-of-Order Webhooks
- **Detection Signal**: `payment.captured` arrives before `payment.authorized`.
- **Authoritative Evidence**: Valid webhook with advanced state `CAPTURED`.
- **Missing / Uncertain Evidence**: Prior intermediate events.
- **Autonomous Action Eligibility**: **ELIGIBLE** for state progression.
- **Required Verification**: Query authoritative provider GET endpoint to reconstruct sequence.
- **Retry / Monitoring Policy**: Synchronize state with provider truth.
- **Duplicate-Action Protections**: State machine permits jumping intermediate states forward, never backward.
- **Safe-Hold / Escalation Condition**: None.
- **Customer Notification**: None.
- **Audit Event Requirements**: `OUT_OF_ORDER_WEBHOOK_RECONCILED`.
- **Test Acceptance Criterion**: State progresses directly to `CAPTURED` without throwing invalid transition error.

---

### Case 17: Webhook Never Arrives (Lost Webhook)
- **Detection Signal**: Payment was created, customer debited, but zero webhooks arrived after 10 minutes.
- **Authoritative Evidence**: Server-side GET `/v1/payments/:id` returns `captured === true`.
- **Missing / Uncertain Evidence**: Provider webhook delivery receipt.
- **Autonomous Action Eligibility**: **ELIGIBLE** for state reconstruction.
- **Required Verification**: Server-side direct API query.
- **Retry / Monitoring Policy**: Background monitoring sweep queries pending payments.
- **Duplicate-Action Protections**: Normal idempotency keys apply.
- **Safe-Hold / Escalation Condition**: None.
- **Customer Notification**: Order confirmed once verified.
- **Audit Event Requirements**: `STATE_RECONSTRUCTED_VIA_POLL`.
- **Test Acceptance Criterion**: Background poll reconstructs state and resolves case when webhooks are lost.

---

### Case 18: Conflicting Provider and Merchant Records
- **Detection Signal**: Gateway records payment for Order A, but merchant order records payment for Order B.
- **Authoritative Evidence**: Conflicting merchant order identifiers.
- **Missing / Uncertain Evidence**: Intended order mapping.
- **Autonomous Action Eligibility**: **NOT ELIGIBLE FOR AUTONOMOUS ACTION**.
- **Required Verification**: Requires operator inspection.
- **Retry / Monitoring Policy**: None.
- **Duplicate-Action Protections**: N/A.
- **Safe-Hold / Escalation Condition**: **IMMEDIATE SAFE_HOLD**.
- **Customer Notification**: *"Your payment is under review by our operations team."*
- **Audit Event Requirements**: `SAFE_HOLD_RECORD_CONFLICT`.
- **Test Acceptance Criterion**: Conflicting cross-record identifiers halt automation and trigger safe-hold.

---

### Case 19: Amount or Currency Mismatch
- **Detection Signal**: Order is ₹1,000 (100000 paise), but payment is ₹900 (90000 paise) or USD 12.
- **Authoritative Evidence**: Integer paise difference $> 0$ or currency code mismatch.
- **Missing / Uncertain Evidence**: Customer explanation or discount code.
- **Autonomous Action Eligibility**: **NOT ELIGIBLE FOR AUTOMATED RESOLUTION**.
- **Required Verification**: Check if authorized partial payment discount exists.
- **Retry / Monitoring Policy**: None.
- **Duplicate-Action Protections**: N/A.
- **Safe-Hold / Escalation Condition**: **IMMEDIATE SAFE_HOLD**.
- **Customer Notification**: *"Payment amount discrepancy detected. Case flagged for review."*
- **Audit Event Requirements**: `SAFE_HOLD_AMOUNT_MISMATCH`.
- **Test Acceptance Criterion**: Any discrepancy in amount or currency locks case into safe-hold.

---

### Case 20: Duplicate Settlement Record
- **Detection Signal**: Bank settlement report contains duplicate payout entries for same payment UTR.
- **Authoritative Evidence**: 2 settlement rows with identical `entityId` and `settlementId`.
- **Missing / Uncertain Evidence**: Bank accounting ledger adjustment.
- **Autonomous Action Eligibility**: **ELIGIBLE** for `MERCHANT_LEDGER_CORRECTION` (deduplication).
- **Required Verification**: Hash-based settlement record ID (`RZPREC-hash`) deduplicates entries.
- **Retry / Monitoring Policy**: Bulk upsert updates single record.
- **Duplicate-Action Protections**: Database unique index `{ settlementRecordId: 1 }`.
- **Safe-Hold / Escalation Condition**: None.
- **Customer Notification**: None.
- **Audit Event Requirements**: `DUPLICATE_SETTLEMENT_DEDUPLICATED`.
- **Test Acceptance Criterion**: Duplicate settlement rows in import file result in single persisted record.

---

### Case 21: Missing Settlement Record
- **Detection Signal**: Captured payment has zero settlement records after $T+5\text{ days}$.
- **Authoritative Evidence**: Gateway shows captured; bank settlement reports show zero payout.
- **Missing / Uncertain Evidence**: Bank settlement UTR.
- **Autonomous Action Eligibility**: **NOT ELIGIBLE FOR REFUND**. Eligible for `ESCALATE_TO_GATEWAY_SUPPORT`.
- **Required Verification**: Confirm with Razorpay settlement inquiry API.
- **Retry / Monitoring Policy**: Poll settlement API once daily.
- **Duplicate-Action Protections**: Zero customer refund allowed.
- **Safe-Hold / Escalation Condition**: **SAFE_HOLD** past $T+5$ days.
- **Customer Notification**: None.
- **Audit Event Requirements**: `SETTLEMENT_OVERDUE_ALERT`.
- **Test Acceptance Criterion**: Overdue settlement flags warning and safe-hold without touching customer funds.

---

### Case 22: Payment Captured But Order Cancelled (Hard Safe-Hold)
- **Detection Signal**: Gateway is `CAPTURED`, but merchant order is `ORDER_CANCELLED`.
- **Authoritative Evidence**: Order cancelled timestamp before or after payment capture.
- **Missing / Uncertain Evidence**: Customer refund preference and cancellation dispute context.
- **Autonomous Action Eligibility**: **NOT ELIGIBLE FOR DISPATCH / UNCONDITIONALLY BLOCKED (HARD SAFE-HOLD)**.
  > **Hard Safe-Hold Invariant**: Case 22 dispatch is unconditionally blocked (`safeHoldCode: "LATE_CAPTURE_CANCELLED_ORDER"`). AI advisory suggestions and caller-supplied flags (`approvedCancellationRefund`, `adminApproval`, etc.) cannot bypass safe-hold. Canonical `MerchantOrder` remains `CANCELLED` and canonical financial records are 100% unmutated.
- **Required Verification**: Human operator review in Admin console.
- **Retry / Monitoring Policy**: Automated retry prohibited.
- **Duplicate-Action Protections**: Concurrency lock and deterministic safe-hold block.
- **Safe-Hold / Escalation Condition**: **UNCONDITIONAL SAFE_HOLD** (`LATE_CAPTURE_CANCELLED_ORDER`).
- **Customer Notification**: *"Your order was cancelled, but a late payment was captured. Your case is held under review by our operations team."*
- **Audit Event Requirements**: `SAFE_HOLD_APPLIED`, `SAFE_HOLD_REASON_RECORDED`.
- **Test Acceptance Criterion**: Captured payment on cancelled order deterministically evaluates to `SAFE_HOLD` (`LATE_CAPTURE_CANCELLED_ORDER`); dispatch route unconditionally rejects execution.

---

### Case 23: Multiple Plausible Payment Candidates (Ambiguity)
- **Detection Signal**: Multiple gateway payments match an order amount within same time window.
- **Authoritative Evidence**: 2 or more unlinked payment candidates (e.g. `ORD-000116` demo scenario).
- **Missing / Uncertain Evidence**: Direct reference or customer linkage.
- **Autonomous Action Eligibility**: **NOT ELIGIBLE FOR AUTOMATION**.
- **Required Verification**: Manual human operator selection.
- **Retry / Monitoring Policy**: None.
- **Duplicate-Action Protections**: Deterministic safety gate locks out resolution.
- **Safe-Hold / Escalation Condition**: **IMMEDIATE SAFE_HOLD** (`requiresReview = true`).
- **Customer Notification**: *"Your payment is under review to verify correct transaction pairing."*
- **Audit Event Requirements**: `SAFE_HOLD_AMBIGUOUS_CANDIDATES`.
- **Test Acceptance Criterion**: Ambiguous candidate pairing forces confidence $< 0.95$ and routes to safe hold.

---

### Case 24: Provider Unavailable or Rate-Limited
- **Detection Signal**: Gateway API returns HTTP 429 Too Many Requests or 5xx Server Error.
- **Authoritative Evidence**: Provider HTTP status code.
- **Missing / Uncertain Evidence**: Provider recovery timeline.
- **Autonomous Action Eligibility**: **ELIGIBLE** for `EXPONENTIAL_BACKOFF_RETRY`.
- **Required Verification**: Provider status endpoint.
- **Retry / Monitoring Policy**: Retries with exponential backoff and full jitter ($2\text{s}, 4\text{s}, 8\text{s}, 16\text{s}$, max 5 attempts).
- **Duplicate-Action Protections**: Maintain same idempotency key across all retries.
- **Safe-Hold / Escalation Condition**: Provider remains down after 5 retries $\rightarrow$ `SAFE_HOLD`.
- **Customer Notification**: None (transparent retry).
- **Audit Event Requirements**: `PROVIDER_RETRY_SCHEDULED`.
- **Test Acceptance Criterion**: HTTP 429/5xx triggers exponential backoff retry with same idempotency key.

---

### Case 25: Database Outage During Resolution Action
- **Detection Signal**: Database connection drops while provider write call is executing.
- **Authoritative Evidence**: Mongo network timeout exception.
- **Missing / Uncertain Evidence**: Whether action succeeded at provider.
- **Autonomous Action Eligibility**: **RECOVERY ON RECONNECT**.
- **Required Verification**: Query provider with idempotency key upon DB reconnection.
- **Retry / Monitoring Policy**: In-flight action lease prevents duplicate execution.
- **Duplicate-Action Protections**: Provider checks idempotency key; DB queries provider before writing.
- **Safe-Hold / Escalation Condition**: Provider state unresolvable upon reconnect $\rightarrow$ `SAFE_HOLD`.
- **Customer Notification**: None until DB reconnects.
- **Audit Event Requirements**: `DB_OUTAGE_RECOVERY_COMPLETED`.
- **Test Acceptance Criterion**: Recovery sweep reconstructs true state from provider without duplicate mutations.

---

### Case 26: Worker Crash While Action Is Pending
- **Detection Signal**: Background worker node dies while `resolutionCaseState === 'CASE_ACTION_IN_PROGRESS'`.
- **Authoritative Evidence**: `actionLeaseExpiresAt < Date.now()` on case record.
- **Missing / Uncertain Evidence**: Completion status of crashed worker.
- **Autonomous Action Eligibility**: **ELIGIBLE** for `LEASE_EXPIRY_RECOVERY`.
- **Required Verification**: Next worker sweep acquires expired lease, queries provider with case idempotency key.
- **Retry / Monitoring Policy**: If provider shows action completed, advance state to `RESOLVED`. If not attempted, retry.
- **Duplicate-Action Protections**: Same idempotency key reused.
- **Safe-Hold / Escalation Condition**: Lease expires $> 3$ times $\rightarrow$ `SAFE_HOLD`.
- **Customer Notification**: None.
- **Audit Event Requirements**: `EXPIRED_LEASE_RECOVERED`.
- **Test Acceptance Criterion**: Expired action lease is claimed by subsequent worker and completed safely.

---

### Case 27: Concurrent Resolution Attempts
- **Detection Signal**: Two background workers or agent turns attempt to resolve same case simultaneously.
- **Authoritative Evidence**: Database optimistic lock or lease update.
- **Missing / Uncertain Evidence**: None.
- **Autonomous Action Eligibility**: **FIRST ATTEMPT EXECUTES; SECOND REJECTED**.
- **Required Verification**: Atomic `findOneAndUpdate` on `{ caseId, status: { $ne: 'ACTION_IN_PROGRESS' } }`.
- **Retry / Monitoring Policy**: Second process receives lock error and aborts immediately.
- **Duplicate-Action Protections**: Atomic database-level concurrency lock.
- **Safe-Hold / Escalation Condition**: None.
- **Customer Notification**: Single resolution notification sent.
- **Audit Event Requirements**: `CONCURRENT_ACTION_BLOCKED`.
- **Test Acceptance Criterion**: 10 simultaneous resolution calls result in exactly 1 provider execution and 9 lock rejections.

---

### Case 28: Cross-Tenant Access Attempt
- **Detection Signal**: Customer A requests case details belonging to Customer B or Merchant B.
- **Authoritative Evidence**: `token.customerId !== case.customerId` or `token.tenantId !== case.tenantId`.
- **Missing / Uncertain Evidence**: None.
- **Autonomous Action Eligibility**: **IMMEDIATE REJECTION**.
- **Required Verification**: Middleware row-level security guard.
- **Retry / Monitoring Policy**: None. Return HTTP 404 or 403.
- **Duplicate-Action Protections**: N/A.
- **Safe-Hold / Escalation Condition**: Security incident logged; caller IP rate-limited.
- **Customer Notification**: *"Access denied."*
- **Audit Event Requirements**: `ACCESS_DENIED_SECURITY_ALERT`.
- **Test Acceptance Criterion**: Cross-tenant request rejected with 403/404; security alert logged in audit trail.

---

### Case 29: Fraud Allegation or Unauthorized Payment Claim
- **Detection Signal**: Customer claims: *"My card was stolen/used without my permission."*
- **Authoritative Evidence**: Fraud claim flag; risk score $> 85$; unusual IP/device velocity.
- **Missing / Uncertain Evidence**: Police report / bank fraud filing.
- **Autonomous Action Eligibility**: **STRICTLY PROHIBITED FROM AUTONOMOUS RESOLUTION**.
- **Required Verification**: Formal fraud investigation.
- **Retry / Monitoring Policy**: None. Freeze all automated refund/capture actions.
- **Duplicate-Action Protections**: Case locked into `SAFE_HOLD`.
- **Safe-Hold / Escalation Condition**: **IMMEDIATE SAFE_HOLD & FRAUD DESK ESCALATION**.
- **Customer Notification**: *"Your fraud claim has been escalated to our security team. Automated processing frozen for your protection."*
- **Audit Event Requirements**: `FRAUD_CLAIM_FROZEN`, `CASE_SAFE_HOLD`.
- **Test Acceptance Criterion**: Fraud claim immediately locks case into safe hold; autonomous actions strictly disabled.

---

### Case 30: Chargeback or Formal Dispute
- **Detection Signal**: Webhook `dispute.created` or bank chargeback notification received.
- **Authoritative Evidence**: Provider dispute object with dispute ID and reason code.
- **Missing / Uncertain Evidence**: Merchant proof of fulfillment (delivery receipt, signature).
- **Autonomous Action Eligibility**: **STRICTLY PROHIBITED FROM AUTONOMOUS REFUND**.
- **Required Verification**: Evidence collection for representment.
- **Retry / Monitoring Policy**: Route to merchant dispute management workflow with dispute deadline.
- **Duplicate-Action Protections**: Gateway automatically debits reserve; issuing autonomous refund causes double loss.
- **Safe-Hold / Escalation Condition**: **IMMEDIATE SAFE_HOLD & DISPUTE WORKFLOW ACTIVATION**.
- **Customer Notification**: Handled via issuing bank.
- **Audit Event Requirements**: `FORMAL_DISPUTE_OPENED`, `CASE_SAFE_HOLD`.
- **Test Acceptance Criterion**: Dispute webhook freezes automated refund and routes case to formal dispute representation queue.
