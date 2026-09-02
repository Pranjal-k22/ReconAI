# ReconAI Benchmark Dataset Specification

## Dataset Identity

- **Dataset Version**: `RECONAI_DEMO_V1`
- **Deterministic Seed**: `RECONAI_DEMO_2026`
- **Import Batch ID**: `BATCH-DEMO-V1`
- **Scenario Count**: `120`

---

## Scenario Distribution

| Classification | Category | Count | Review Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `MATCHED` | Clean Match | 80 | `false` | Perfect 3-way exact match across Order, Gateway Payment, and Settlement Record. |
| `AMOUNT_MISMATCH` | Anomaly | 8 | `true` | Gateway payment amount or settlement net amount differs from merchant order amount. |
| `MISSING_SETTLEMENT` | Anomaly | 6 | `true` | Merchant order and gateway payment captured, but absent in bank settlement payout. |
| `DUPLICATE_PAYMENT` | Anomaly | 5 | `true` | Two captured gateway payments linked to a single merchant order. |
| `FEE_MISMATCH` | Anomaly | 5 | `true` | Actual gateway fee or tax charged in settlement payout differs from synthetic benchmark fee policy. |
| `REFUND_MISMATCH` | Anomaly | 4 | `true` | Gateway refund amount conflicts with bank settlement refund payout line item. |
| `MISSING_PAYMENT` | Anomaly | 4 | `true` | Merchant order created but no corresponding gateway payment or settlement exists. |
| `REFERENCE_MISMATCH` | Anomaly | 3 | `true` | Amounts match, but payment `merchantOrderId` or settlement `entityId` reference link is broken/mismatched. |
| `AMBIGUOUS` | Uncertainty | 3 | `true` | Multiple plausible payment candidates for an order with unlinked settlement evidence. |
| `INVALID_DATA` | Validation | 2 | `true` | Schema-valid records with conflicting currency (`USD` vs `INR`) or `UNKNOWN` statuses. |

---

## Record Types & Generated Counts

1. **MerchantOrder** (120 records): Source of truth for customer purchase intent.
2. **GatewayPayment** (124 records): Gateway payment receipts (includes extra duplicate/candidate records).
3. **SettlementRecord** (112 records): Bank settlement line items (includes refund adjustments).
4. **GroundTruth** (120 records): Expected scenario answers and evaluation targets.

---

## Synthetic Benchmark Fee Policy

For clean benchmark scenarios, gateway fees and taxes are calculated deterministically:

```text
feePaise = Math.round(amountPaise * 0.02)      // 2% Gateway Fee
taxPaise = Math.round(feePaise * 0.18)         // 18% GST on Fee
netAmountPaise = amountPaise - feePaise - taxPaise
```

> **Note**: This synthetic fee formula is used strictly for benchmark testing and evaluation. Production systems support custom gateway fee contracts.

---

## GroundTruth Isolation

- Ground truth records are stored in the `GroundTruth` collection with `datasetVersion = "RECONAI_DEMO_V1"`.
- Production input CSV files (`merchant_orders.csv`, `gateway_payments.csv`, `settlements.csv`) contain **NO** ground truth fields (`expectedClassification`, `expectedPaymentIds`, etc.).
- Ground truth data is accessed **ONLY** by benchmark evaluation scripts to measure engine precision, recall, and accuracy.

---

## Determinism & Reproducibility

- The benchmark dataset is generated using a custom seeded PRNG (`Mulberry32`) initialized with `seed = "RECONAI_DEMO_2026"`.
- Executing `npm run demo:generate` or `generateBenchmarkData()` always produces identical record IDs, amounts, dates, and classifications.

---

## Primary Graceful-Failure Demo Scenario

- **Merchant Order ID**: [`ORD-000116`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/demo/benchmarkGenerator.js#L12)
- **Amount**: ₹1,499.00 (149900 paise)
- **Scenario Description**: Two captured payments (`PAY-000116-A` and `PAY-000116-B`) exist for the order with plausible timestamps. The settlement record is unlinked (`entityId = "pay_UNLINKED_AMBIGUOUS"`).
- **Expected Engine Behavior**: Auto-reconciliation blocked (`confidence < 0.95`), classified as `AMBIGUOUS`, zero automated financial mutations executed, routed to Exception Queue for Gemini AI advisory analysis and human review.

---

## Limitations

- Synthetic dataset contains simulated transactions, not live banking records.
- Fee calculations use a benchmark approximation.
- Anomalies are intentionally injected according to hackathon evaluation benchmarks.
