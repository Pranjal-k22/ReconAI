# ReconAI Evaluation Method & Benchmark Metrics

## Purpose
This document outlines the evaluation methodology, operational metrics, statistical definitions, and architectural isolation guarantees used by ReconAI to measure financial reconciliation accuracy, exception detection precision/recall, and engine throughput.

---

## GroundTruth Isolation Guarantee
To prevent evaluation leakage and maintain strict system integrity:
1. **Production Engine Isolation**: `ReconciliationRun` creation, scenario grouping, matching engine rules, and `ReconciliationResult` persistence NEVER import or access `GroundTruth` answer keys. (Enforced by static architecture guard [`groundTruthIsolationGuard.test.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/tests/reconciliation/groundTruthIsolationGuard.test.js)).
2. **Evaluation-Only Access**: `GroundTruth` model data is imported strictly within [`evaluationService.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/evaluation/evaluationService.js) to evaluate persisted run results after processing completes.

---

## Operational Metrics (No GroundTruth Required)
Operational metrics are calculated dynamically from persisted `ReconciliationResult` and `ExceptionCase` records:

- **`totalScenarios`**: Count of merchant order scenarios processed in the run.
- **`matchedCount`**: Count of clean `MATCHED` scenarios.
- **`exceptionCount`**: Count of scenarios flagged with `requiresReview = true`.
- **`autoReconciledCount`**: Count of scenarios where `autoResolved = true`.
- **`manualReviewCount`**: Count of scenarios routed to human/AI review.
- **`unresolvedRecords`**: Count of `ExceptionCase` records in `OPEN` or `UNDER_REVIEW` status. (*Note: AI investigation does NOT equal financial resolution; a human decision is required for resolution.*)
- **`autoReconciliationRate`**: $\frac{\text{autoReconciledCount}}{\text{totalScenarios}}$
- **`throughputRecordsPerSecond`**: $\frac{\text{processedRecords}}{\text{durationSeconds}}$
- **Financial Value Invariant**:
  - `totalAmountProcessedPaise`: Total gross order amount ($\sum \text{expectedAmountPaise}$)
  - `autoReconciledAmountPaise`: Total gross order amount for clean `MATCHED` scenarios
  - `amountUnderReviewPaise`: Total gross order amount for anomaly scenarios ($\text{totalAmountProcessedPaise} - \text{autoReconciledAmountPaise}$)
  - **Financial Sum Invariant**: $\text{totalAmountProcessedPaise} = \text{autoReconciledAmountPaise} + \text{amountUnderReviewPaise}$


---

## Benchmark Evaluation Statistics (GroundTruth Compared)

### 1. Classification Accuracy
$$\text{Accuracy} = \frac{\text{Correct Classifications}}{\text{Total Scenarios}}$$

### 2. Exception Detection Metrics
Defines a **Positive** as any scenario where GroundTruth $\neq \text{MATCHED}$ (i.e. an anomaly).

- **True Positive (TP)**: GroundTruth is an anomaly, and Engine predicted an anomaly.
- **True Negative (TN)**: GroundTruth is clean `MATCHED`, and Engine predicted `MATCHED`.
- **False Positive (FP)**: GroundTruth is clean `MATCHED`, but Engine predicted an anomaly.
- **False Negative (FN)**: GroundTruth is an anomaly, but Engine predicted `MATCHED`.

### 3. Precision, Recall, and F1 Score
$$\text{Precision} = \frac{\text{TP}}{\text{TP} + \text{FP}}$$

$$\text{Recall} = \frac{\text{TP}}{\text{TP} + \text{FN}}$$

$$\text{F1 Score} = 2 \times \frac{\text{Precision} \times \text{Recall}}{\text{Precision} + \text{Recall}}$$

---

## Per-Class Evaluation
Calculated for all 12 supported classifications:
$$\text{Class Precision} = \frac{\text{Class Correct Count}}{\text{Class Predicted Count}}$$
$$\text{Class Recall} = \frac{\text{Class Correct Count}}{\text{Class GroundTruth Count}}$$

---

## Why Metrics Are Not Hard-Coded
All metrics are computed dynamically at runtime:
1. Operational metrics are computed directly from MongoDB `ReconciliationResult` documents by [`metricsService.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/reconciliation/metricsService.js).
2. Evaluation statistics are computed by joining `ReconciliationResult` documents with `GroundTruth` answer keys by [`evaluationService.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/evaluation/evaluationService.js).
3. Unit tests ([`evaluationService.test.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/tests/evaluation/evaluationService.test.js)) verify that altered prediction fixtures produce altered accuracy, precision, and false-positive numbers.

---

## Current Measured Benchmark Results (`RECONAI_DEMO_V1`)

### Operational Metrics
- **Run ID**: `FCRUN-20260930112205-FLIR`
- **Status**: `COMPLETED_WITH_EXCEPTIONS`
- **Total Scenarios**: 120
- **Matched Count**: 80
- **Exception Count**: 40
- **Unresolved Exceptions**: 40 (`OPEN` or `UNDER_REVIEW` status)
- **Auto Reconciliation Rate**: **66.67%** (80 / 120)
- **Throughput**: **12.51 records/sec** (live database persisted with automated AI investigation dispatch)
- **Total Amount Processed**: ₹1,030,180.00 (103,018,000 paise)
- **Auto-Reconciled Amount**: ₹717,020.00 (71,702,000 paise)
- **Amount Under Review**: ₹313,160.00 (31,316,000 paise)
- **Financial Sum Invariant**: ₹7,17,020.00 + ₹3,13,160.00 = ₹10,30,180.00 (**PASS**)



### Operational Classification Breakdown
```json
{
  "MATCHED": 80,
  "AMOUNT_MISMATCH": 8,
  "MISSING_SETTLEMENT": 6,
  "DUPLICATE_PAYMENT": 5,
  "FEE_MISMATCH": 5,
  "REFUND_MISMATCH": 4,
  "MISSING_PAYMENT": 4,
  "REFERENCE_MISMATCH": 3,
  "AMBIGUOUS": 3,
  "INVALID_DATA": 2,
  "DUPLICATE_SETTLEMENT": 0,
  "STATUS_MISMATCH": 0
}
```

### Benchmark Evaluation Accuracy (`RECONAI_DEMO_V1` vs `GroundTruth`)
- **Total Evaluated**: 120 / 120
- **Correct**: 120
- **Incorrect**: 0
- **Classification Accuracy**: **100.00%**
- **Precision**: **100.00%**
- **Recall**: **100.00%**
- **F1 Score**: **100.00%**

---

## Track 4 Phase 4 — Safety & Audit Verification

- **Phase Status**: VERIFIED & HARDENED (PASS).
- **Verified Evaluation & Safety Invariants**:
  - **GroundTruth Isolation Guard**: [`groundTruthIsolationGuard.test.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/tests/reconciliation/groundTruthIsolationGuard.test.js) verifies zero imports of `GroundTruth.js` inside production matching engine or controller agent files.
  - **AI Available vs Fallback Parity**:
    - **Gemini Available**: 120 scenarios processed, 80 MATCHED, 40 Exceptions, 100% accuracy, 12.51 rec/s throughput.
    - **Gemini Unavailable (Fallback)**: 120 scenarios processed, 80 MATCHED, 40 Exceptions, 100% accuracy, fallback explanations generated cleanly without altering matching predictions or amounts.
    - **Conclusion**: Financial truth is 100% governed by deterministic engine; AI availability does not alter operational match rate or evaluation statistics.

---

## Track 4 Phase 5 — Metrics, Reporting & Benchmark Hardening

- **Phase Status**: VERIFIED & HARDENED (PASS).
- **Metric Isolation Invariant**:
  - **Operational Match Rate**: **66.67%** ($\frac{80 \text{ matched}}{120 \text{ scenarios}}$). Measures the ratio of clean auto-reconcilable orders in the batch.
  - **GroundTruth Classification Accuracy**: **100.00%** ($\frac{120 \text{ correct predictions}}{120 \text{ evaluated scenarios}}$). Measures how accurately the engine categorized both matched and anomaly scenarios against known ground truth keys.
- **Financial Sum Invariant Verification**:
  - Total Processed Amount: ₹1,030,180.00 (103,018,000 paise)
  - Auto-Reconciled Amount: ₹717,020.00 (71,702,000 paise)
  - Amount Under Review: ₹313,160.00 (31,316,000 paise)
  - Invariant Assertion: `totalAmountProcessedPaise === autoReconciledAmountPaise + amountUnderReviewPaise` (**PASSED**).
- **Dynamic Metric Edge Case Safety**:
  - `evaluationService.js` and `metricsService.js` use safe mathematical formulas preventing `NaN` or `Infinity` divisions when evaluating empty or zero-denominator scenarios.


