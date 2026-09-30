import "dotenv/config";
import mongoose from "mongoose";
import { getEnv } from "../src/config/env.js";
import { runFinanceControllerBatch } from "../src/services/finance/financeControllerAgent.js";
import { runReconciliationBatch } from "../src/services/reconciliation/reconciliationService.js";
import { ReconciliationResult } from "../src/models/ReconciliationResult.js";


async function executeControllerVerification() {
  const env = getEnv();
  await mongoose.connect(env.MONGODB_URI);
  console.log("Connected to MongoDB Atlas");

  console.log("Launching Finance Controller Agent Run...");
  const controllerRun = await runFinanceControllerBatch({
    name: "Track 4 Finance Controller Benchmark Verification",
    sourceMode: "SYNTHETIC",
    importBatchId: "BATCH-DEMO-V1",
    datasetVersion: "RECONAI_DEMO_V1",
    autoInvestigate: true
  });

  console.log("\n==========================================");
  console.log("FINANCE CONTROLLER AGENT BENCHMARK REPORT");
  console.log("==========================================");
  console.log(`runId:                      ${controllerRun.runId}`);
  console.log(`reconciliationRunId:        ${controllerRun.reconciliationRunId}`);
  console.log(`controllerState:            ${controllerRun.controllerState}`);
  console.log(`status:                     ${controllerRun.status}`);
  console.log(`batchSize:                  ${controllerRun.batchSize}`);
  console.log(`processedRecords:           ${controllerRun.processedRecords}`);
  console.log(`matchedRecords:             ${controllerRun.matchedRecords}`);
  console.log(`exceptionRecords:           ${controllerRun.exceptionRecords}`);
  console.log(`autoResolvedRecords:        ${controllerRun.autoResolvedRecords}`);
  console.log(`manualReviewRecords:        ${controllerRun.manualReviewRecords}`);
  console.log(`unresolvedRecords:          ${controllerRun.unresolvedRecords}`);
  console.log(`matchRate:                  ${controllerRun.matchRate}%`);
  console.log(`exceptionRate:              ${controllerRun.exceptionRate}%`);
  console.log(`throughput:                 ${controllerRun.throughput} rec/sec`);
  console.log(`totalAmountProcessedPaise:  ${controllerRun.totalAmountProcessedPaise}`);
  console.log(`autoReconciledAmountPaise:  ${controllerRun.autoReconciledAmountPaise}`);
  console.log(`amountUnderReviewPaise:     ${controllerRun.amountUnderReviewPaise}`);
  console.log("==========================================");

  // Compare with direct underlying reconciliation run
  const directRun = await runReconciliationBatch({
    name: "Direct Comparison Batch",
    sourceMode: "SYNTHETIC",
    importBatchId: "BATCH-DEMO-V1",
    datasetVersion: "RECONAI_DEMO_V1"
  });

  const controllerResults = await ReconciliationResult.find({ runId: controllerRun.reconciliationRunId }).sort({ merchantOrderId: 1 }).lean();
  const directResults = await ReconciliationResult.find({ runId: directRun.runId }).sort({ merchantOrderId: 1 }).lean();

  console.log("\n==========================================");
  console.log("DIRECT ENGINE VS CONTROLLER COMPARISON");
  console.log("==========================================");
  console.log(`Controller Results Count: ${controllerResults.length}`);
  console.log(`Direct Results Count:     ${directResults.length}`);

  let mismatches = 0;
  for (let i = 0; i < controllerResults.length; i++) {
    const c = controllerResults[i];
    const d = directResults[i];

    if (
      c.classification !== d.classification ||
      c.confidence !== d.confidence ||
      c.expectedAmountPaise !== d.expectedAmountPaise ||
      c.actualAmountPaise !== d.actualAmountPaise ||
      c.autoResolved !== d.autoResolved ||
      c.requiresReview !== d.requiresReview
    ) {
      mismatches++;
      console.error(`Mismatch on ${c.merchantOrderId}: Controller=${c.classification} vs Direct=${d.classification}`);
    }
  }

  console.log(`Result Invariant Mismatches: ${mismatches}`);
  console.log("==========================================");

  await mongoose.disconnect();
}

executeControllerVerification().catch(console.error);
