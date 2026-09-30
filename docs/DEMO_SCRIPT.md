# ReconAI — Hackathon Demo Script (3–5 Minutes)

This script guides the live presenter through demonstrating ReconAI to hackathon judges.

---

## 0:00–0:30 — Problem Statement

> "Reconciling merchant orders against payment gateway records and bank payout settlements is one of the highest-friction problems in finance operations. Manual reconciliation is slow, error-prone, and doesn't scale. But fully automated 'black-box' AI is dangerous—if an AI system makes a mistake on missing or ambiguous financial data, funds can be misallocated without any audit trail.
> 
> ReconAI solves this with a **Verification-First Architecture**: deterministic rules do 100% of the matching, confidence gates block ambiguous cases, Gemini AI acts purely as an advisory investigator for human review, and an append-only audit trail logs every single event."

---

## 0:30–1:00 — Architecture & Controls

> "Let's look at the system architecture:
> 
> 1. **Pure Deterministic Matching Engine**: Operates in-memory using integer paise arithmetic. GroundTruth answer keys are strictly isolated and never accessed during reconciliation.
> 2. **Confidence Safety Gate**: Auto-reconciliation strictly requires ≥95% evidence confidence AND zero anomaly flags.
> 3. **AI Advisory Boundary**: Google Gemini model is invoked strictly on-demand for exception root-cause investigation. It cannot mutate financial classifications or move funds.
> 4. **Append-Only Audit Trail**: Every batch run, AI request, and human decision is logged immutably with automatic credential sanitization."

---

## 1:00–1:45 — Live Benchmark Run (Dashboard)

*(Action: Click "Run Demo Reconciliation" on the Dashboard)*

> "We are executing our 120-scenario synthetic benchmark (`RECONAI_DEMO_V1`, seed `RECONAI_DEMO_2026`).
> 
> Notice the results:
> - **120 total transactions processed**
> - **80 auto-reconciled** (exact match confidence = 100%, 0 anomalies)
> - **40 exceptions flagged** into the human review queue
> - **66.67% auto-reconciliation rate**
> - **Controller Throughput**: 12.51 records/sec (Full persisted controller workflow)
> - **Gross processed value**: ₹10,30,180.00
> - **Automatically reconciled value**: ₹7,17,020.00
> - **Held under review**: ₹3,13,160.00"

---

## 1:45–2:45 — Graceful Failure Showcase (`ORD-000116`)

*(Action: Navigate to Exceptions -> Filter by `AMBIGUOUS` -> Open `ORD-000116`)*

> "Here is the key showcase of ReconAI's financial safety: Order `ORD-000116`.
> 
> Notice the banner: **'Automatic Reconciliation Blocked — Manual Review Required'**.
> 
> In this scenario, two separate gateway payment records exist (`PAY-000116-A` and `PAY-000116-B`) with matching amounts but unlinked settlement records. Rather than taking a guess or picking an arbitrary candidate, ReconAI's engine scores evidence confidence at 45%, deterministically classifies it as `AMBIGUOUS`, and locks out automatic resolution.
> 
> **ReconAI refuses to guess when financial evidence is uncertain.**"

---

## 2:45–3:30 — AI Advisory Investigation & Human Review

*(Action: Click "Investigate with AI" -> Review Gemini / Fallback response -> Submit Human Decision `KEEP_EXCEPTION`)*

> "Next, we invoke Google Gemini for exception analysis. Gemini analyzes the deterministic rule evidence and explains *why* the ambiguity exists and recommends operational next steps.
> 
> Notice the disclaimer: **'Advisory only — AI cannot modify reconciliation or move funds.'**
> 
> Even if the AI provider is unavailable, ReconAI generates a deterministic fallback explanation with zero workflow disruption.
> 
> Now, as a finance reviewer, I select **'Keep Exception'**, enter resolution notes, and submit. The human review workflow status updates to `RESOLVED`, but notice: **the original deterministic classification `AMBIGUOUS` remains immutably preserved for auditability.**"

---

## 3:30–4:15 — Audit Trail & Independent Evaluation

*(Action: Open Audit Trail -> Inspect latest event -> Navigate to Evaluation)*

> "Every single action—the batch execution, the AI investigation request, and my human decision—is logged in our append-only Audit Trail. Clicking 'Payload' lets us inspect the exact sanitized JSON state change.
> 
> Finally, let's open the **Evaluation Page**.
> 
> Our GroundTruth evaluation service runs in total isolation. It compares the deterministic predictions against GroundTruth:
> - **120 / 120 correct classifications**
> - **100% Classification Accuracy**
> - **100% Exception Precision**
> - **100% Exception Recall**
> - **100% F1 Score**
> 
> *Note: These 100% metrics are measured against our synthetic benchmark dataset to prove algorithmic correctness, not claimed as universal real-world performance.*"

---

## 4:15–4:30 — Summary & Wrap-Up

> "Three key takeaways to remember:
> 
> 1. **ReconAI automates the obvious** (80/120 exact matches resolved instantly).
> 2. **ReconAI refuses to guess** (ambiguous cases are blocked safely).
> 3. **AI explains exceptions, but humans remain in complete control.**
> 
> Thank you!"
