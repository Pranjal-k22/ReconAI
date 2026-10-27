# ReconAI Client — Web Application & Operator Workspace

ReconAI Client is a modern React application built with Vite and Tailwind CSS. It provides a dual-surface interface:
1. **The Autonomous Financial Controller Dashboard & Simulator**: Visualizes batch three-way reconciliation runs, synthetic benchmark datasets, GroundTruth evaluation matrices, and human review exception queues.
2. **The ReconAI 2.0 Read-Only Operator Workspace (Stage 6B)**: Role-aware, token-scoped operator control center for inspecting live payment cases, 8-dimension state grids, provider facts vs unverified customer claims, append-only lifecycle timelines, multi-agent advisory investigations, policy evaluations, and safe-hold queues.

---

## Architecture & Security Principles

### 1. Token-Only Multi-Tenant Scoping
- **No Client-Side Tenant Selector**: In accordance with the Stage 6B architecture specification, multi-tenant isolation is enforced purely at the server layer via verified JWT claims.
- **Header Stripping**: The workspace API client ([client/src/api/casesApi.js](file:///c:/WEB%20DEVELOPMENT/ReconAI/client/src/api/casesApi.js)) intercepts all outgoing requests and strips any caller-provided `x-tenant-id` header or URL tenant parameter.
- **Tenant Context**:
  - `SHOP` and `AUDITOR` tokens are bound to their assigned tenant on the server; the backend automatically filters queries.
  - `ADMIN` tokens operate across all tenants.
  - Cross-tenant navigation attempts (e.g. Shop A opening a Tenant B case URL) return clean 404 Not Found responses with zero data leakage.

### 2. Read-Only by Construction
- **Zero Mutation Invocations**: The workspace API module exports strictly `GET` operations:
  - `fetchPaymentCases`
  - `fetchPaymentCaseById`
  - `fetchCaseClassification`
  - `fetchCaseLifecycleEvents`
  - `fetchCaseInvestigations`
  - `fetchCaseEvidence`
  - `fetchCasePolicyDecisions`
  - `fetchCaseProviderOperations`
- **Zero Mutation Buttons**: The case workspace includes zero buttons that classify, investigate, dispatch, release, or edit records.
- **Automated Export & Network Audit**: Enforced by automated tests and browser network logging confirming zero `POST`, `PUT`, `PATCH`, or `DELETE` requests from the workspace.

### 3. Role-Aware Navigation Barrier
- [client/src/components/common/RoleGuard.jsx](file:///c:/WEB%20DEVELOPMENT/ReconAI/client/src/components/common/RoleGuard.jsx) intercepts routes `/cases` and `/cases/:caseId`.
- **Allowed Roles**: `ADMIN`, `SHOP`, `AUDITOR`.
- **Blocked Roles**: `CUSTOMER` and machine service accounts receive an inline *"not available for your role"* notification without triggering any background API data fetchers.

### 4. Text-Only Rendering & XSS Protection
- **Zero `dangerouslySetInnerHTML`**: All dynamic data, customer claims, agent commentary, and provider notes are rendered as pure text via [client/src/components/common/ExpandableText.jsx](file:///c:/WEB%20DEVELOPMENT/ReconAI/client/src/components/common/ExpandableText.jsx).
- **Hostile Script Mitigation**: Unsanitized or malicious customer claims (such as `<script>alert(1)</script>`) render completely inert as string literals, preventing cross-site scripting vulnerabilities.

### 5. Pure Integer Financial Formatting
- [client/src/utils/formatMoney.js](file:///c:/WEB%20DEVELOPMENT/ReconAI/client/src/utils/formatMoney.js) formats all paise amounts using integer arithmetic:
  ```javascript
  const rupees = Math.trunc(paise / 100);
  const remainingPaise = Math.abs(paise % 100);
  // Zero floating-point rounding errors across 0, 1 paise, and large numbers
  ```

---

## Operator Workspace Views

### Cases List Page (`/cases`)
- **Live API Data Badge**: Prominently displays an indicator confirming connection to live backend endpoints.
- **Safe-Hold Queue View (`/cases?safeHold=true`)**: Instant filter displaying all payment exceptions held under safe-hold policy, displaying reason codes and case age.
- **Resolution Status Filters**: Filter cases by `CASE_DETECTED`, `CASE_ACTION_IN_PROGRESS`, `CASE_RESOLVED`, or `CASE_SAFE_HOLD`.
- **Pagination**: Server-driven pagination controls.

### Case Detail Page (`/cases/:caseId`)
1. **8-Dimension State Grid**: Real-time visualization of `orderStatus`, `captureStatus`, `authorizationStatus`, `refundStatus`, `disputeStatus`, `customerDebitStatus`, `resolutionCaseStatus`, and `discrepancyCategory`.
2. **Amounts & Mismatch Panel**: Compares expected order amount, gateway payment amount, and computes difference in paise and INR.
3. **Classification Panel**: Displays scenario ID, reason code, safe-hold code, and clearly distinguishes verified provider facts from customer claims (badged *"claim, unverified"*). Displays backend evidence record staleness directly from API.
4. **Lifecycle Events Timeline**: Append-only chronological timeline of ingested gateway events.
5. **Multi-Agent Advisory Investigations**: Displays four agent perspective cards (Customer, Shop, Findings, Resolution Proposal), explicitly labeled *"Advisory only"* with live-vs-fallback markers.
6. **Policy Decisions**: Lists policy evaluations alongside the governing `policyConfigVersion`.
7. **Provider Operations**: Read-only ledger of idempotent provider actions.
8. **Safe-Hold Banner**: Explicit banner for held cases. For Case 22, displays: *"late capture on a cancelled order: held, no automatic refund or reopen"*.

---

## Available Scripts

### Development Server
```bash
npm run dev
# Starts Vite development server at http://localhost:5173
```

### Production Build
```bash
npm run build
# Compiles optimized production bundle into dist/ (verified clean, 0 errors)
```

### Client Test Suite
```bash
npm test
# Executes Vitest suite with JSDOM and React Testing Library (26 tests across 5 test files)
```

### Interactive Test Runner
```bash
npm run test:watch
# Launches Vitest in interactive watch mode
```

---

## Client Directory Structure

```text
client/
├── src/
│   ├── api/
│   │   ├── axios.js                  # Central axios instance
│   │   ├── casesApi.js               # Read-only operator workspace API module
│   │   ├── exceptionApi.js           # Exception management API
│   │   ├── financeControllerApi.js   # Autonomous controller API
│   │   ├── integrationApi.js         # Integration status API
│   │   ├── razorpayApi.js            # Razorpay sync API
│   │   └── reconciliationApi.js      # Reconciliation run API
│   ├── components/
│   │   ├── common/
│   │   │   ├── ExpandableText.jsx    # Text-only truncation/expansion component
│   │   │   ├── RoleGuard.jsx         # Role-aware route guard
│   │   │   └── ...
│   │   └── layout/
│   ├── pages/
│   │   ├── CaseDetailPage.jsx        # Read-only case detail workspace view
│   │   ├── CasesListPage.jsx         # Read-only case list & safe-hold queue view
│   │   ├── DashboardPage.jsx         # Autonomous reconciliation dashboard
│   │   └── ...
│   ├── tests/
│   │   ├── setup.js                  # Testing library environment setup
│   │   ├── casesApi.test.js          # Export and header stripping invariant tests
│   │   ├── RoleGuard.test.jsx        # Role-based route guard tests
│   │   ├── CasesListPage.test.jsx    # List view rendering & filter tests
│   │   ├── CaseDetailPage.test.jsx   # Detail view, grid, and XSS safety tests
│   │   └── formatMoney.test.js       # Integer paise-to-INR arithmetic tests
│   ├── utils/
│   │   ├── formatMoney.js            # Shared integer paise formatter
│   │   └── ...
│   ├── App.jsx                       # Application router and shell
│   └── main.jsx
├── package.json
└── vite.config.js
```
