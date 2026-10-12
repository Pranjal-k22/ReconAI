# Phase 7 — Multi-Agent AI Investigation and Evidence Exchange

## 1. Executive Summary

Phase 7 implements the tenant-scoped multi-agent AI investigation and evidence exchange layer for ReconAI 2.0.

The architecture organizes four bounded AI roles into a controller-mediated workflow:
- **`CUSTOMER_AI`**: Synthesizes the authenticated customer's recorded claims, reported debit evidence, and payment summaries without access to other tenants or internal secrets.
- **`SHOP_AI`**: Synthesizes the merchant store's order state, fulfillment requirements, and payment evidence without exposure to unrelated customer PII.
- **`INVESTIGATOR_AI`**: Synthesizes controller-assembled evidence cards, explicitly categorizing verified provider facts vs unverified claims, highlighting contradictions, missing evidence, and applicable deterministic rules.
- **`RESOLUTION_PLANNER_AI`**: Proposes advisory next steps strictly bounded to non-executable `ALLOWED_ADVISORY_STEPS`. Strictly non-authoritative (`isExecutable: false`, `authoritative: false`, `requiresPolicyEngine: true`).

Agents collaborate exclusively through the orchestrator service (`multiAgentInvestigator.js`). They have no direct inter-agent messaging, arbitrary DB query tools, or execution authority.

---

## 2. Core Architectural Guarantees

1. **Deterministic Foundation Remains Authoritative**:
   - The Phase 6 deterministic classification engine (`evidenceClassifier.js`) remains the sole authoritative baseline for edge-case identification.
   - AI outputs are untrusted advisory interpretations. AI can never upgrade unverified claims to verified provider facts.
2. **Strict Zod Contract Validation**:
   - Every agent step validates both input cards (`EvidenceCardSchema`) and output payloads (`CustomerAiOutputSchema`, `ShopAiOutputSchema`, `InvestigatorAiOutputSchema`, `ResolutionPlannerAiOutputSchema`).
   - Malformed, schema-violating, or invalid JSON responses trigger resilient deterministic fallbacks.
3. **Controller-Mediated Evidence Exchange**:
   - The controller queries the database through tenant-scoped services and filters evidence cards per agent role.
   - Citations in agent responses are cross-checked (`validateCitedEvidence`). Hallucinated or unauthorized card IDs are detected and stripped.
4. **Prompt Injection & Hostile Input Defenses**:
   - Delimiters and override instructions (e.g., `ignore previous instructions`, `authorize immediate refund`) are neutralized to `[NEUTRALIZED_COMMAND]`.
   - Credentials, JWTs, and provider secrets are sanitized to `[REDACTED_SECRET]`.
   - Script tags are stripped to `[STRIPPED_SCRIPT]`.
5. **Resilient Gemini Fallback**:
   - When Gemini is disabled, missing API keys, or encounters rate limits (429) or timeouts, the orchestrator seamlessly generates deterministic fallbacks without failing ingestion or payment workflows.
6. **Non-Executability Invariant**:
   - Resolution Planner output strictly enforces `isExecutable: false`, `authoritative: false`, and `requiresPolicyEngine: true`.
   - No financial write APIs exist in `razorpayClient.js`. Zero payment, order, refund, or settlement states are mutated by investigation runs.
7. **Durable Persistence & Idempotency**:
   - Persisted in MongoDB via `AiInvestigationRun` model with compound indexes on `{ tenantId, caseId }` and `{ tenantId, idempotencyKey }`.
   - Repeated requests with the same `idempotencyKey` return identical runs without duplicate DB writes.

---

## 3. Agent Contract Schemas

### 3.1 Role Permissions and Access Boundaries

| Role | Permitted Inputs | Prohibited Inputs | Authority |
| :--- | :--- | :--- | :--- |
| `CUSTOMER_AI` | Authenticated customer's claims, reported debit evidence, safe status summaries | Unrelated customer records, other merchant cases, provider API keys, internal prompts | Advisory (`isExecutable: false`) |
| `SHOP_AI` | Tenant merchant order state, provider status summaries, case debit status | Unrelated customer PII, other merchants' records, provider credentials | Advisory (`isExecutable: false`) |
| `INVESTIGATOR_AI` | Scoped evidence cards assembled by controller for the specific case | Arbitrary DB queries, cross-tenant records, provider write operations | Advisory (`isExecutable: false`) |
| `RESOLUTION_PLANNER_AI` | Investigation findings, deterministic classification summary, approved policy notes | Direct execution authority, arbitrary tool calls, mutation capabilities | Strictly non-executable (`isExecutable: false`) |

### 3.2 Allowed Advisory Next Steps (`ALLOWED_ADVISORY_STEPS`)
- `ADVISORY_MONITOR_OR_NO_ACTION`
- `ADVISORY_MANUAL_REVIEW_REQUIRED`
- `ADVISORY_INVESTIGATE_GATEWAY_DROP`
- `ADVISORY_AWAIT_SETTLEMENT_RECONCILIATION`
- `ADVISORY_REQUEST_CUSTOMER_BANK_STATEMENT`
- `ADVISORY_REQUEST_MERCHANT_FULFILLMENT_UPDATE`
- `ADVISORY_CHECK_PROVIDER_OUTAGE`
- `ADVISORY_POLICY_EVALUATION_PENDING`

---

## 4. API Endpoints

### 4.1 `POST /api/payment-cases/:caseId/investigate`
- **Authorized Roles**: `ADMIN`, `PAYMENT_CONTROLLER`, `SHOP`, `SHOP_AI`, `CUSTOMER`, `CUSTOMER_AI`.
- **Row-Level Tenant & Customer Scoping**:
  - Customers can only investigate their own cases (`caseDoc.customerId === req.user.customerId`).
  - Merchants can only investigate their own tenant's cases.
- **Request Body**:
  ```json
  {
    "idempotencyKey": "optional-idempotency-key"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "investigationId": "INV-1728734000000-A1B2C3D4",
      "caseId": "CASE-001",
      "tenantId": "tenant_merch_01",
      "status": "COMPLETED",
      "customerPerspective": { ... },
      "shopPerspective": { ... },
      "investigatorFindings": { ... },
      "resolutionProposal": {
        "suggestedNextStep": "ADVISORY_MONITOR_OR_NO_ACTION",
        "rationale": "...",
        "isExecutable": false,
        "authoritative": false,
        "requiresPolicyEngine": true
      },
      "isExecutable": false,
      "authoritative": false,
      "requiresPolicyEngine": true
    }
  }
  ```

### 4.2 `GET /api/payment-cases/:caseId/investigations`
- Returns historical investigation runs for the specified case, scoped to tenant and customer.

---

## 5. Verification Gates and Observed Results

1. **Multi-Agent Core & Contract Tests** (`tests/ai/multiAgentInvestigation.test.js`):
   - 12 passed (isolation, prompt injection, schemas, citation verification, fallback compliance, non-executability).
2. **Route & Authorization Tests** (`tests/routes/paymentCaseInvestigationRoutes.test.js`):
   - 7 passed (auth gates, role isolation, customer scoping, cross-tenant isolation, idempotency).
3. **Real MongoDB Persistence & Idempotency** (`tests/integration/multiAgentInvestigationPersistence.integration.test.js`):
   - 4 passed (real DB persistence, compound index idempotency, tenant filtering, non-mutability of payment/order records).
4. **Monitoring & Payment State Machine** (`tests/monitoring`):
   - 34 passed across 3 test files.
5. **Webhook Ingestion & Signatures** (`tests/webhook`):
   - 25 passed across 2 test files.
6. **Phase 6 Classification Matrix** (`tests/classification`):
   - 41 passed across 30 deterministic edge cases and telemetry provenance tests.
7. **Full Real MongoDB Integration Suite** (`npm run test:integration`):
   - 41 passed across 6 integration test suites.
8. **Full Backend Unit Suite** (`npm test`):
   - 432 passed across 60 test files.
9. **Frontend Production Build** (`npm run build` in `client`):
   - Built cleanly in 8.20s with zero errors.
10. **Git Diff Hygiene** (`git diff --check`):
    - Clean diff, zero whitespace issues or conflict markers.
11. **Deterministic Benchmark** (`tests/reconciliation/benchmarkCompatibility.test.js`):
    - 120/120 scenarios classified correctly (100.00% match rate).

---

## 6. Safety Statement

- **Zero Provider Write APIs**: `razorpayClient.js` contains no mutation or financial write functions.
- **Zero Financial State Mutations**: AI investigation runs never mutate `GatewayPayment`, `MerchantOrder`, or `PaymentCase` states.
- **Phase 8 (Autonomous Resolution Actions)**: Has **NOT** started. System stops here for review.
