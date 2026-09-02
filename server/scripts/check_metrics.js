import mongoose from "mongoose";
import { getEnv } from "../src/config/env.js";
import { MerchantOrder } from "../src/models/MerchantOrder.js";
import { GatewayPayment } from "../src/models/GatewayPayment.js";
import { SettlementRecord } from "../src/models/SettlementRecord.js";
import { ReconciliationRun } from "../src/models/ReconciliationRun.js";
import { ReconciliationResult } from "../src/models/ReconciliationResult.js";
import { reconcileScenario } from "../src/services/reconciliation/matchingEngine.js";
import { groupScenarioRecords } from "../src/services/reconciliation/reconciliationService.js";
import { calculateRunMetrics } from "../src/services/reconciliation/metricsService.js";

async function runDiagnostic() {
  const env = getEnv();
  await mongoose.connect(env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const importBatchId = "BATCH-DEMO-V1";
  const orders = await MerchantOrder.find({ importBatchId }).lean();
  const payments = await GatewayPayment.find({ importBatchId }).lean();
  const settlements = await SettlementRecord.find({ importBatchId }).lean();

  console.log(`Orders count: ${orders.length}`);
  console.log(`Payments count: ${payments.length}`);
  console.log(`Settlements count: ${settlements.length}`);

  let totalOrderAmountPaise = 0;
  for (const o of orders) {
    totalOrderAmountPaise += o.amountPaise;
  }
  console.log(`Total Order Amount (Paise): ${totalOrderAmountPaise}`);

  let matchedSumPaise = 0;
  let reviewSumPaise = 0;
  let matchedCount = 0;
  let reviewCount = 0;

  for (const order of orders) {
    const scenario = groupScenarioRecords(order, payments, settlements);
    const engineResult = reconcileScenario(scenario);
    const isMatched = engineResult.classification === "MATCHED";

    if (isMatched) {
      matchedCount++;
      matchedSumPaise += order.amountPaise;
    } else {
      reviewCount++;
      reviewSumPaise += order.amountPaise;
    }
  }

  console.log("=== DIRECT COMPUTATION FROM ENGINE + MERCHANT ORDER ===");
  console.log(`Matched Count: ${matchedCount}`);
  console.log(`Review Count: ${reviewCount}`);
  console.log(`Matched Amount (Paise): ${matchedSumPaise}`);
  console.log(`Review Amount (Paise): ${reviewSumPaise}`);
  console.log(`Total Sum Check: ${matchedSumPaise + reviewSumPaise}`);

  // Check latest run in DB
  const latestRun = await ReconciliationRun.findOne().sort({ createdAt: -1 }).lean();
  if (latestRun) {
    console.log("=== LATEST RUN IN DB ===");
    console.log(`Run ID: ${latestRun.runId}`);
    console.log(`Status: ${latestRun.status}`);
    console.log(`Metrics in DB:`, JSON.stringify(latestRun.metrics, null, 2));

    const dbResults = await ReconciliationResult.find({ runId: latestRun.runId }).lean();
    let dbMatchedSum = 0;
    let dbReviewSum = 0;
    for (const r of dbResults) {
      const exp = r.expectedAmountPaise || 0;
      if (r.autoResolved) {
        dbMatchedSum += exp;
      }
      if (r.requiresReview) {
        dbReviewSum += exp;
      }
    }
    console.log(`DB Results Matched Sum (expAmountPaise): ${dbMatchedSum}`);
    console.log(`DB Results Review Sum (expAmountPaise): ${dbReviewSum}`);
  }

  await mongoose.disconnect();
}

runDiagnostic().catch(console.error);
