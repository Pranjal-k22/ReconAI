import SeededRandom from "./prng.js";
import { rupeesToPaise } from "../../utils/money.js";

export const BENCHMARK_CONSTANTS = {
  DATASET_VERSION: "RECONAI_DEMO_V1",
  SEED: "RECONAI_DEMO_2026",
  IMPORT_BATCH_ID: "BATCH-DEMO-V1",
  PRIMARY_AMBIGUOUS_ORDER_ID: "ORD-000116",
  DISTRIBUTION: {
    MATCHED: 80,
    AMOUNT_MISMATCH: 8,
    MISSING_SETTLEMENT: 6,
    DUPLICATE_PAYMENT: 5,
    FEE_MISMATCH: 5,
    REFUND_MISMATCH: 4,
    MISSING_PAYMENT: 4,
    REFERENCE_MISMATCH: 3,
    AMBIGUOUS: 3,
    INVALID_DATA: 2
  }
};

const BASE_AMOUNTS_INR = [
  199, 499, 799, 999, 1299, 1499, 1999, 2499, 3999, 4999, 7499, 9999, 12999, 14999, 24999, 49999
];

/**
 * Calculates synthetic benchmark gateway fee (2% + 18% GST on fee).
 */
export function calculateBenchmarkFee(amountPaise) {
  const feePaise = Math.round(amountPaise * 0.02);
  const taxPaise = Math.round(feePaise * 0.18);
  const netAmountPaise = amountPaise - feePaise - taxPaise;
  return { feePaise, taxPaise, netAmountPaise };
}

/**
 * Generates 120 deterministic synthetic benchmark scenario records.
 */
export function generateBenchmarkData(customSeed = BENCHMARK_CONSTANTS.SEED) {
  const rng = new SeededRandom(customSeed);

  const merchantOrders = [];
  const gatewayPayments = [];
  const settlementRecords = [];
  const groundTruth = [];

  let scenarioIndex = 1;

  // Helper to format 6-digit IDs
  const formatId = (num) => String(num).padStart(6, "0");

  // Helper to compute benchmark date strings deterministically
  const getBenchmarkDates = (dayOffset) => {
    const day = 1 + (dayOffset % 28);
    const dayStr = String(day).padStart(2, "0");
    const orderDate = new Date(`2026-08-${dayStr}T10:00:00.000Z`);
    const paymentDate = new Date(`2026-08-${dayStr}T10:02:00.000Z`);
    const settlementDate = new Date(`2026-08-${dayStr}T10:00:00.000Z`);
    settlementDate.setDate(settlementDate.getDate() + 2);

    return { orderDate, paymentDate, settlementDate };
  };

  const createScenarioRecords = (type) => {
    const idStr = formatId(scenarioIndex);
    const orderId = `ORD-${idStr}`;
    const { orderDate, paymentDate, settlementDate } = getBenchmarkDates(scenarioIndex);

    // Pick deterministic base amount
    const baseINR = rng.choice(BASE_AMOUNTS_INR);
    const amountPaise = rupeesToPaise(baseINR);
    const customerRef = `CUST-${rng.nextInt(1000, 9999)}`;
    const batchId = BENCHMARK_CONSTANTS.IMPORT_BATCH_ID;

    const { feePaise, taxPaise, netAmountPaise } = calculateBenchmarkFee(amountPaise);

    switch (type) {
      case "MATCHED": {
        // 1 Order, 1 Payment, 1 Settlement
        const payId = `PAY-${idStr}-A`;
        const setRecId = `SETREC-${idStr}-A`;
        const setBatchId = `SET-202608-${Math.ceil(scenarioIndex / 10)}`;

        merchantOrders.push({
          merchantOrderId: orderId,
          customerReference: customerRef,
          amountPaise,
          currency: "INR",
          status: "PAID",
          source: "SYNTHETIC",
          createdAtSource: orderDate,
          importBatchId: batchId
        });

        gatewayPayments.push({
          gatewayPaymentId: payId,
          merchantOrderId: orderId,
          amountPaise,
          currency: "INR",
          status: "CAPTURED",
          method: rng.choice(["UPI", "CARD", "NETBANKING"]),
          feePaise,
          taxPaise,
          refundAmountPaise: 0,
          gatewayCreatedAt: paymentDate,
          source: "SYNTHETIC",
          importBatchId: batchId
        });

        settlementRecords.push({
          settlementRecordId: setRecId,
          settlementId: setBatchId,
          entityId: payId,
          merchantOrderId: orderId,
          grossAmountPaise: amountPaise,
          feePaise,
          taxPaise,
          netAmountPaise,
          currency: "INR",
          settledAt: settlementDate,
          utr: `UTR${idStr}99`,
          type: "PAYMENT",
          source: "SYNTHETIC",
          importBatchId: batchId
        });

        groundTruth.push({
          datasetVersion: BENCHMARK_CONSTANTS.DATASET_VERSION,
          merchantOrderId: orderId,
          expectedClassification: "MATCHED",
          expectedPaymentIds: [payId],
          expectedSettlementRecordIds: [setRecId],
          expectedRequiresReview: false,
          notes: "Clean 3-way exact match benchmark scenario"
        });
        break;
      }

      case "AMOUNT_MISMATCH": {
        // Order amount ₹1,499.00 vs Gateway Payment ₹1,399.00
        const payId = `PAY-${idStr}-A`;
        const setRecId = `SETREC-${idStr}-A`;
        const setBatchId = `SET-202608-${Math.ceil(scenarioIndex / 10)}`;

        const payAmountPaise = amountPaise - rupeesToPaise(100); // ₹100 discrepancy
        const payFee = calculateBenchmarkFee(payAmountPaise);

        merchantOrders.push({
          merchantOrderId: orderId,
          customerReference: customerRef,
          amountPaise,
          currency: "INR",
          status: "PAID",
          source: "SYNTHETIC",
          createdAtSource: orderDate,
          importBatchId: batchId
        });

        gatewayPayments.push({
          gatewayPaymentId: payId,
          merchantOrderId: orderId,
          amountPaise: payAmountPaise,
          currency: "INR",
          status: "CAPTURED",
          method: "UPI",
          feePaise: payFee.feePaise,
          taxPaise: payFee.taxPaise,
          refundAmountPaise: 0,
          gatewayCreatedAt: paymentDate,
          source: "SYNTHETIC",
          importBatchId: batchId
        });

        settlementRecords.push({
          settlementRecordId: setRecId,
          settlementId: setBatchId,
          entityId: payId,
          merchantOrderId: orderId,
          grossAmountPaise: payAmountPaise,
          feePaise: payFee.feePaise,
          taxPaise: payFee.taxPaise,
          netAmountPaise: payFee.netAmountPaise,
          currency: "INR",
          settledAt: settlementDate,
          utr: `UTR${idStr}99`,
          type: "PAYMENT",
          source: "SYNTHETIC",
          importBatchId: batchId
        });

        groundTruth.push({
          datasetVersion: BENCHMARK_CONSTANTS.DATASET_VERSION,
          merchantOrderId: orderId,
          expectedClassification: "AMOUNT_MISMATCH",
          expectedPaymentIds: [payId],
          expectedSettlementRecordIds: [setRecId],
          expectedRequiresReview: true,
          notes: `Amount mismatch: Order amount ₹${baseINR} vs Gateway Payment ₹${baseINR - 100}`
        });
        break;
      }

      case "MISSING_SETTLEMENT": {
        // Order & Payment exist, but NO SettlementRecord
        const payId = `PAY-${idStr}-A`;

        merchantOrders.push({
          merchantOrderId: orderId,
          customerReference: customerRef,
          amountPaise,
          currency: "INR",
          status: "PAID",
          source: "SYNTHETIC",
          createdAtSource: orderDate,
          importBatchId: batchId
        });

        gatewayPayments.push({
          gatewayPaymentId: payId,
          merchantOrderId: orderId,
          amountPaise,
          currency: "INR",
          status: "CAPTURED",
          method: "CARD",
          feePaise,
          taxPaise,
          refundAmountPaise: 0,
          gatewayCreatedAt: paymentDate,
          source: "SYNTHETIC",
          importBatchId: batchId
        });

        groundTruth.push({
          datasetVersion: BENCHMARK_CONSTANTS.DATASET_VERSION,
          merchantOrderId: orderId,
          expectedClassification: "MISSING_SETTLEMENT",
          expectedPaymentIds: [payId],
          expectedSettlementRecordIds: [],
          expectedRequiresReview: true,
          notes: "Captured gateway payment absent from bank settlement payout"
        });
        break;
      }

      case "DUPLICATE_PAYMENT": {
        // 1 Order, 2 competing GatewayPayments
        const payIdA = `PAY-${idStr}-A`;
        const payIdB = `PAY-${idStr}-B`;
        const setRecId = `SETREC-${idStr}-A`;
        const setBatchId = `SET-202608-${Math.ceil(scenarioIndex / 10)}`;

        merchantOrders.push({
          merchantOrderId: orderId,
          customerReference: customerRef,
          amountPaise,
          currency: "INR",
          status: "PAID",
          source: "SYNTHETIC",
          createdAtSource: orderDate,
          importBatchId: batchId
        });

        gatewayPayments.push(
          {
            gatewayPaymentId: payIdA,
            merchantOrderId: orderId,
            amountPaise,
            currency: "INR",
            status: "CAPTURED",
            method: "UPI",
            feePaise,
            taxPaise,
            refundAmountPaise: 0,
            gatewayCreatedAt: paymentDate,
            source: "SYNTHETIC",
            importBatchId: batchId
          },
          {
            gatewayPaymentId: payIdB,
            merchantOrderId: orderId,
            amountPaise,
            currency: "INR",
            status: "CAPTURED",
            method: "UPI",
            feePaise,
            taxPaise,
            refundAmountPaise: 0,
            gatewayCreatedAt: new Date(paymentDate.getTime() + 60000),
            source: "SYNTHETIC",
            importBatchId: batchId
          }
        );

        settlementRecords.push({
          settlementRecordId: setRecId,
          settlementId: setBatchId,
          entityId: payIdA,
          merchantOrderId: orderId,
          grossAmountPaise: amountPaise,
          feePaise,
          taxPaise,
          netAmountPaise,
          currency: "INR",
          settledAt: settlementDate,
          utr: `UTR${idStr}99`,
          type: "PAYMENT",
          source: "SYNTHETIC",
          importBatchId: batchId
        });

        groundTruth.push({
          datasetVersion: BENCHMARK_CONSTANTS.DATASET_VERSION,
          merchantOrderId: orderId,
          expectedClassification: "DUPLICATE_PAYMENT",
          expectedPaymentIds: [payIdA, payIdB],
          expectedSettlementRecordIds: [setRecId],
          expectedRequiresReview: true,
          notes: "Two captured gateway payments linked to single merchant order"
        });
        break;
      }

      case "FEE_MISMATCH": {
        // Order & Payment match, but actual fee charged in settlement is ₹50 instead of synthetic 2%
        const payId = `PAY-${idStr}-A`;
        const setRecId = `SETREC-${idStr}-A`;
        const setBatchId = `SET-202608-${Math.ceil(scenarioIndex / 10)}`;

        const actualFeePaise = rupeesToPaise(50);
        const actualTaxPaise = Math.round(actualFeePaise * 0.18);
        const actualNetPaise = amountPaise - actualFeePaise - actualTaxPaise;

        merchantOrders.push({
          merchantOrderId: orderId,
          customerReference: customerRef,
          amountPaise,
          currency: "INR",
          status: "PAID",
          source: "SYNTHETIC",
          createdAtSource: orderDate,
          importBatchId: batchId
        });

        gatewayPayments.push({
          gatewayPaymentId: payId,
          merchantOrderId: orderId,
          amountPaise,
          currency: "INR",
          status: "CAPTURED",
          method: "CARD",
          feePaise: actualFeePaise,
          taxPaise: actualTaxPaise,
          refundAmountPaise: 0,
          gatewayCreatedAt: paymentDate,
          source: "SYNTHETIC",
          importBatchId: batchId
        });

        settlementRecords.push({
          settlementRecordId: setRecId,
          settlementId: setBatchId,
          entityId: payId,
          merchantOrderId: orderId,
          grossAmountPaise: amountPaise,
          feePaise: actualFeePaise,
          taxPaise: actualTaxPaise,
          netAmountPaise: actualNetPaise,
          currency: "INR",
          settledAt: settlementDate,
          utr: `UTR${idStr}99`,
          type: "PAYMENT",
          source: "SYNTHETIC",
          importBatchId: batchId
        });

        groundTruth.push({
          datasetVersion: BENCHMARK_CONSTANTS.DATASET_VERSION,
          merchantOrderId: orderId,
          expectedClassification: "FEE_MISMATCH",
          expectedPaymentIds: [payId],
          expectedSettlementRecordIds: [setRecId],
          expectedRequiresReview: true,
          notes: "Actual gateway fee in settlement differs from benchmark fee policy"
        });
        break;
      }

      case "REFUND_MISMATCH": {
        // Refund recorded on payment as ₹500, but settlement refund record contains ₹300
        const payId = `PAY-${idStr}-A`;
        const setRecIdPay = `SETREC-${idStr}-A`;
        const setRecIdRef = `SETREC-${idStr}-B`;
        const setBatchId = `SET-202608-${Math.ceil(scenarioIndex / 10)}`;

        const refundPaiseGateway = rupeesToPaise(500);
        const refundPaiseSettlement = rupeesToPaise(300);

        merchantOrders.push({
          merchantOrderId: orderId,
          customerReference: customerRef,
          amountPaise,
          currency: "INR",
          status: "REFUNDED",
          source: "SYNTHETIC",
          createdAtSource: orderDate,
          importBatchId: batchId
        });

        gatewayPayments.push({
          gatewayPaymentId: payId,
          merchantOrderId: orderId,
          amountPaise,
          currency: "INR",
          status: "REFUNDED",
          method: "UPI",
          feePaise,
          taxPaise,
          refundAmountPaise: refundPaiseGateway,
          gatewayCreatedAt: paymentDate,
          source: "SYNTHETIC",
          importBatchId: batchId
        });

        settlementRecords.push(
          {
            settlementRecordId: setRecIdPay,
            settlementId: setBatchId,
            entityId: payId,
            merchantOrderId: orderId,
            grossAmountPaise: amountPaise,
            feePaise,
            taxPaise,
            netAmountPaise,
            currency: "INR",
            settledAt: settlementDate,
            utr: `UTR${idStr}99`,
            type: "PAYMENT",
            source: "SYNTHETIC",
            importBatchId: batchId
          },
          {
            settlementRecordId: setRecIdRef,
            settlementId: setBatchId,
            entityId: payId,
            merchantOrderId: orderId,
            grossAmountPaise: refundPaiseSettlement,
            feePaise: 0,
            taxPaise: 0,
            netAmountPaise: -refundPaiseSettlement,
            currency: "INR",
            settledAt: new Date(settlementDate.getTime() + 86400000),
            utr: `UTR${idStr}88`,
            type: "REFUND",
            source: "SYNTHETIC",
            importBatchId: batchId
          }
        );

        groundTruth.push({
          datasetVersion: BENCHMARK_CONSTANTS.DATASET_VERSION,
          merchantOrderId: orderId,
          expectedClassification: "REFUND_MISMATCH",
          expectedPaymentIds: [payId],
          expectedSettlementRecordIds: [setRecIdPay, setRecIdRef],
          expectedRequiresReview: true,
          notes: "Refund amount mismatch between gateway (₹500) and settlement payout (₹300)"
        });
        break;
      }

      case "MISSING_PAYMENT": {
        // Order exists, but NO GatewayPayment & NO Settlement
        merchantOrders.push({
          merchantOrderId: orderId,
          customerReference: customerRef,
          amountPaise,
          currency: "INR",
          status: "PENDING",
          source: "SYNTHETIC",
          createdAtSource: orderDate,
          importBatchId: batchId
        });

        groundTruth.push({
          datasetVersion: BENCHMARK_CONSTANTS.DATASET_VERSION,
          merchantOrderId: orderId,
          expectedClassification: "MISSING_PAYMENT",
          expectedPaymentIds: [],
          expectedSettlementRecordIds: [],
          expectedRequiresReview: true,
          notes: "Merchant order exists without gateway payment or bank settlement"
        });
        break;
      }

      case "REFERENCE_MISMATCH": {
        // Gateway payment points to a wrong/mismatched order ID reference
        const payId = `PAY-${idStr}-A`;
        const setRecId = `SETREC-${idStr}-A`;
        const setBatchId = `SET-202608-${Math.ceil(scenarioIndex / 10)}`;
        const wrongOrderId = `ORD-99${idStr}`;

        merchantOrders.push({
          merchantOrderId: orderId,
          customerReference: customerRef,
          amountPaise,
          currency: "INR",
          status: "PAID",
          source: "SYNTHETIC",
          createdAtSource: orderDate,
          importBatchId: batchId
        });

        gatewayPayments.push({
          gatewayPaymentId: payId,
          merchantOrderId: wrongOrderId, // Mismatched reference
          amountPaise,
          currency: "INR",
          status: "CAPTURED",
          method: "UPI",
          feePaise,
          taxPaise,
          refundAmountPaise: 0,
          gatewayCreatedAt: paymentDate,
          source: "SYNTHETIC",
          importBatchId: batchId
        });

        settlementRecords.push({
          settlementRecordId: setRecId,
          settlementId: setBatchId,
          entityId: payId,
          merchantOrderId: wrongOrderId,
          grossAmountPaise: amountPaise,
          feePaise,
          taxPaise,
          netAmountPaise,
          currency: "INR",
          settledAt: settlementDate,
          utr: `UTR${idStr}99`,
          type: "PAYMENT",
          source: "SYNTHETIC",
          importBatchId: batchId
        });

        groundTruth.push({
          datasetVersion: BENCHMARK_CONSTANTS.DATASET_VERSION,
          merchantOrderId: orderId,
          expectedClassification: "REFERENCE_MISMATCH",
          expectedPaymentIds: [payId],
          expectedSettlementRecordIds: [setRecId],
          expectedRequiresReview: true,
          notes: `Reference mismatch: Payment references ${wrongOrderId} instead of ${orderId}`
        });
        break;
      }

      case "AMBIGUOUS": {
        // Primary ambiguous scenario (Order ORD-000116 with two identical candidate payments ₹1,499 and unlinked settlement)
        const payIdA = `PAY-${idStr}-A`;
        const payIdB = `PAY-${idStr}-B`;
        const setRecId = `SETREC-${idStr}-A`;
        const setBatchId = `SET-202608-${Math.ceil(scenarioIndex / 10)}`;

        merchantOrders.push({
          merchantOrderId: orderId,
          customerReference: customerRef,
          amountPaise,
          currency: "INR",
          status: "PAID",
          source: "SYNTHETIC",
          createdAtSource: orderDate,
          importBatchId: batchId
        });

        gatewayPayments.push(
          {
            gatewayPaymentId: payIdA,
            merchantOrderId: orderId,
            amountPaise,
            currency: "INR",
            status: "CAPTURED",
            method: "UPI",
            feePaise,
            taxPaise,
            refundAmountPaise: 0,
            gatewayCreatedAt: paymentDate,
            source: "SYNTHETIC",
            importBatchId: batchId
          },
          {
            gatewayPaymentId: payIdB,
            merchantOrderId: orderId,
            amountPaise,
            currency: "INR",
            status: "CAPTURED",
            method: "UPI",
            feePaise,
            taxPaise,
            refundAmountPaise: 0,
            gatewayCreatedAt: new Date(paymentDate.getTime() + 120000),
            source: "SYNTHETIC",
            importBatchId: batchId
          }
        );

        settlementRecords.push({
          settlementRecordId: setRecId,
          settlementId: setBatchId,
          entityId: "pay_UNLINKED_AMBIGUOUS",
          merchantOrderId: null, // Unlinked settlement
          grossAmountPaise: amountPaise,
          feePaise,
          taxPaise,
          netAmountPaise,
          currency: "INR",
          settledAt: settlementDate,
          utr: `UTR${idStr}99`,
          type: "PAYMENT",
          source: "SYNTHETIC",
          importBatchId: batchId
        });

        groundTruth.push({
          datasetVersion: BENCHMARK_CONSTANTS.DATASET_VERSION,
          merchantOrderId: orderId,
          expectedClassification: "AMBIGUOUS",
          expectedPaymentIds: [payIdA, payIdB],
          expectedSettlementRecordIds: [setRecId],
          expectedRequiresReview: true,
          notes: "Primary graceful-failure demo scenario: Ambiguous payments and unlinked settlement"
        });
        break;
      }

      case "INVALID_DATA": {
        // Schema-valid record with reconciliation-invalid data (e.g. status UNKNOWN with missing linking keys)
        const payId = `PAY-${idStr}-A`;

        merchantOrders.push({
          merchantOrderId: orderId,
          customerReference: null,
          amountPaise,
          currency: "INR",
          status: "UNKNOWN",
          source: "SYNTHETIC",
          createdAtSource: orderDate,
          importBatchId: batchId
        });

        gatewayPayments.push({
          gatewayPaymentId: payId,
          merchantOrderId: null, // Missing reference
          amountPaise,
          currency: "USD", // Conflicting currency
          status: "UNKNOWN",
          method: "UNKNOWN",
          feePaise: 0,
          taxPaise: 0,
          refundAmountPaise: 0,
          gatewayCreatedAt: paymentDate,
          source: "SYNTHETIC",
          importBatchId: batchId
        });

        groundTruth.push({
          datasetVersion: BENCHMARK_CONSTANTS.DATASET_VERSION,
          merchantOrderId: orderId,
          expectedClassification: "INVALID_DATA",
          expectedPaymentIds: [payId],
          expectedSettlementRecordIds: [],
          expectedRequiresReview: true,
          notes: "Reconciliation-invalid payload: Conflicting currency USD vs INR and UNKNOWN statuses"
        });
        break;
      }

      default:
        throw new Error(`Unknown scenario type: ${type}`);
    }

    scenarioIndex++;
  };

  // Generate exact distribution (Total: 120)
  const dist = BENCHMARK_CONSTANTS.DISTRIBUTION;

  for (let i = 0; i < dist.MATCHED; i++) createScenarioRecords("MATCHED");
  for (let i = 0; i < dist.AMOUNT_MISMATCH; i++) createScenarioRecords("AMOUNT_MISMATCH");
  for (let i = 0; i < dist.MISSING_SETTLEMENT; i++) createScenarioRecords("MISSING_SETTLEMENT");
  for (let i = 0; i < dist.DUPLICATE_PAYMENT; i++) createScenarioRecords("DUPLICATE_PAYMENT");
  for (let i = 0; i < dist.FEE_MISMATCH; i++) createScenarioRecords("FEE_MISMATCH");
  for (let i = 0; i < dist.REFUND_MISMATCH; i++) createScenarioRecords("REFUND_MISMATCH");
  for (let i = 0; i < dist.MISSING_PAYMENT; i++) createScenarioRecords("MISSING_PAYMENT");
  for (let i = 0; i < dist.REFERENCE_MISMATCH; i++) createScenarioRecords("REFERENCE_MISMATCH");
  for (let i = 0; i < dist.AMBIGUOUS; i++) createScenarioRecords("AMBIGUOUS");
  for (let i = 0; i < dist.INVALID_DATA; i++) createScenarioRecords("INVALID_DATA");

  const summary = {
    datasetVersion: BENCHMARK_CONSTANTS.DATASET_VERSION,
    seed: customSeed,
    importBatchId: BENCHMARK_CONSTANTS.IMPORT_BATCH_ID,
    scenarioCount: merchantOrders.length,
    merchantOrderCount: merchantOrders.length,
    gatewayPaymentCount: gatewayPayments.length,
    settlementRecordCount: settlementRecords.length,
    groundTruthCount: groundTruth.length,
    distribution: dist
  };

  // Run validation checks
  validateGeneratedDataset({ merchantOrders, gatewayPayments, settlementRecords, groundTruth, summary });

  return {
    datasetVersion: BENCHMARK_CONSTANTS.DATASET_VERSION,
    seed: customSeed,
    importBatchId: BENCHMARK_CONSTANTS.IMPORT_BATCH_ID,
    merchantOrders,
    gatewayPayments,
    settlementRecords,
    groundTruth,
    summary
  };
}

/**
 * Validates dataset integrity and invariants loudly.
 */
export function validateGeneratedDataset(data) {
  const { merchantOrders, gatewayPayments, settlementRecords, groundTruth, summary } = data;

  if (merchantOrders.length !== 120) {
    throw new Error(`Dataset validation failed: Expected 120 orders, got ${merchantOrders.length}`);
  }

  if (groundTruth.length !== 120) {
    throw new Error(`Dataset validation failed: Expected 120 ground truth records, got ${groundTruth.length}`);
  }

  // Check unique IDs
  const orderIds = new Set(merchantOrders.map((o) => o.merchantOrderId));
  if (orderIds.size !== merchantOrders.length) {
    throw new Error("Dataset validation failed: Duplicate merchantOrderId detected");
  }

  const paymentIds = new Set(gatewayPayments.map((p) => p.gatewayPaymentId));
  if (paymentIds.size !== gatewayPayments.length) {
    throw new Error("Dataset validation failed: Duplicate gatewayPaymentId detected");
  }

  const settlementRecIds = new Set(settlementRecords.map((s) => s.settlementRecordId));
  if (settlementRecIds.size !== settlementRecords.length) {
    throw new Error("Dataset validation failed: Duplicate settlementRecordId detected");
  }

  // Check GroundTruth leakage: ensure NO input records contain ground truth answer fields
  const forbiddenFields = [
    "expectedClassification",
    "expectedPaymentIds",
    "expectedSettlementRecordIds",
    "expectedRequiresReview",
    "groundTruth",
    "expectedResult"
  ];

  for (const record of [...merchantOrders, ...gatewayPayments, ...settlementRecords]) {
    for (const field of forbiddenFields) {
      if (field in record) {
        throw new Error(`GroundTruth leakage detected: Field '${field}' found in input record!`);
      }
    }
  }
}
