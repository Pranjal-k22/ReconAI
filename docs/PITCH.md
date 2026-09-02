# ReconAI — Elevator Pitches & Summary

## 30-Second Elevator Pitch

> "ReconAI is a verification-first AI finance controller for merchants. Standard reconciliation engines either force manual review for everything or blindly automate ambiguous edge cases. ReconAI uses a pure deterministic rules engine to auto-reconcile 100% verified transactions, while isolating uncertain financial anomalies into a human review queue. Google Gemini acts purely as an advisory investigator—explaining root causes without ever altering financial data—all backed by an immutable, append-only audit trail."

---

## 90-Second Executive Summary

> "Financial reconciliation across merchant orders, gateway payments, and settlement payouts is one of the highest-cost operations for digital businesses. Small discrepancies in gateway fees, duplicate payments, or ambiguous references accumulate into significant financial exposure.
> 
> ReconAI introduces a **Verification-First Architecture**:
> 
> 1. **Pure Deterministic Matching Engine**: Uses integer paise arithmetic and strict evidence hierarchies to auto-reconcile exact matches.
> 2. **Confidence Safety Gate**: Ambiguous cases (such as multiple candidate payments for a single order) are automatically locked out from auto-resolution.
> 3. **AI Advisory Investigation**: Google Gemini analyzes deterministic rule evidence on-demand to explain *why* an anomaly occurred and recommend resolution steps, backed by a 100% deterministic fallback explanation.
> 4. **Human Review & Classification Preservation**: Human operators make the resolution decision, but the original deterministic classification remains immutable for audit compliance.
> 5. **Append-Only Audit Trail**: Every batch run, AI request, and human decision is logged immutably with automatic credential sanitization.
> 
> Tested against a 120-scenario benchmark across 10 anomaly classes, ReconAI achieves 100% accuracy while keeping human operators in complete control of financial resolution."
