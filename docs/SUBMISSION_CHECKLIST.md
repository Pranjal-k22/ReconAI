# ReconAI — Hackathon Submission Checklist

- [x] **Repository Structure**: Clean monorepo structure with `client/` and `server/` managed by root `package.json`.
- [x] **README Documentation**: Comprehensive `README.md` containing problem statement, verification-first solution, Mermaid architecture diagram, classification matrix, benchmark results, AI safety invariants, Razorpay safety rules, API overview, and local setup guide.
- [x] **Backend Integration Tests**: 170 / 170 Vitest tests passing across 41 test files (`cd server && npm test`).
- [x] **Frontend Production Build**: Vite React production bundle verified (`cd client && npm run build` passing with 0 errors).
- [x] **MongoDB Atlas Database**: Live Atlas connection verified with pre-seeded 120-scenario synthetic benchmark (`RECONAI_DEMO_V1`, seed `RECONAI_DEMO_2026`).
- [x] **Reconciliation Engine**: Pure in-memory matching engine (`matchingEngine.js`) executing 120 scenarios (80 MATCHED, 40 Exceptions) with 100% classification accuracy.
- [x] **Financial Totals**: Verified exact sum invariant (`totalAmountProcessedPaise = autoReconciledAmountPaise + amountUnderReviewPaise`). All values formatted from integer paise (`formatINRFromPaise`).
- [x] **GroundTruth Isolation**: GroundTruth isolation guard test (`groundTruthIsolationGuard.test.js`) verified passing (0 GroundTruth imports in reconciliation paths).
- [x] **AI Advisory Boundary**: Google Gemini investigator (`exceptionInvestigator.js`) integrated via `@google/genai` with Zod runtime safety validation and 15s deterministic fallback explanation (`fallbackExplanation.js`).
- [x] **Human Review Workflow**: Decision service (`humanReviewService.js`) verified preserving original deterministic classifications on human approval/resolution.
- [x] **Append-Only Audit Trail**: Audit service (`auditService.js`) verified logging all batch runs, AI queries, and human decisions with recursive credential redacting (`[REDACTED]`).
- [x] **Razorpay Read-Only Sync**: Test Mode client (`razorpayClient.js`) and safety guard (`validateTestModeSafety()`) verified blocking live keys and stripping customer PII.
- [x] **Frontend Console UI**: 10 pages/views implemented (Dashboard, Runs, Run Details, Exceptions, Exception Details, Audit Trail, Evaluation, Data Import, Razorpay Sync, 404).
- [x] **Security Audit**: Source tree scanned; zero real secrets committed in git repository.
- [x] **Demo Walkthrough Script**: 3–5 minute hackathon presenter script created (`docs/DEMO_SCRIPT.md`).
- [x] **Judging Alignment**: Judging dimensions matrix and safety invariant table created (`docs/JUDGING_CRITERIA.md`).
- [x] **Pitch Summaries**: 30-second elevator pitch and 90-second executive summary created (`docs/PITCH.md`).
- [x] **SPA Routing Fallback**: Vercel rewrite configuration created (`client/vercel.json`).
