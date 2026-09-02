import mongoose from "mongoose";
import { getEnv } from "../src/config/env.js";
import { runReconciliationBatch } from "../src/services/reconciliation/reconciliationService.js";
import { evaluateReconciliationRun } from "../src/services/evaluation/evaluationService.js";

async function executeFreshRun() {
  const env = getEnv();
  await mongoose.connect(env.MONGODB_URI);
  console.log("Connected to MongoDB Atlas");

  console.log("Launching fresh synthetic benchmark run...");
  const newRun = await runReconciliationBatch({
    name: "ReconAI Authoritative Pre-Deployment Benchmark",
    sourceMode: "SYNTHETIC",
    importBatchId: "BATCH-DEMO-V1",
    datasetVersion: "RECONAI_DEMO_V1"
  });

  console.log("\n==========================================");
  console.log("AUTHORITATIVE PRE-DEPLOYMENT BENCHMARK RUN");
  console.log("==========================================");
  console.log(`runId:                      ${newRun.runId}`);
  console.log(`status:                     ${newRun.status}`);
  console.log(`processedRecords:           ${newRun.processedRecords}`);
  console.log(`matchedCount:               ${newRun.metrics.matchedCount}`);
  console.log(`exceptionCount:             ${newRun.metrics.exceptionCount}`);
  console.log(`totalAmountProcessedPaise:  ${newRun.metrics.totalAmountProcessedPaise}`);
  console.log(`autoReconciledAmountPaise:  ${newRun.metrics.autoReconciledAmountPaise}`);
  console.log(`amountUnderReviewPaise:     ${newRun.metrics.amountUnderReviewPaise}`);
  console.log("==========================================");

  // Run evaluation against GroundTruth
  const evalResult = await evaluateReconciliationRun(newRun.runId);
  console.log("\n==========================================");
  console.log("GROUNDTRUTH EVALUATION RESULT");
  console.log("==========================================");
  console.log(`Accuracy:  ${(evalResult.overallMetrics.accuracy * 100).toFixed(2)}%`);
  console.log(`Precision: ${(evalResult.overallMetrics.precision * 100).toFixed(2)}%`);
  console.log(`Recall:    ${(evalResult.overallMetrics.recall * 100).toFixed(2)}%`);
  console.log(`F1 Score:  ${(evalResult.overallMetrics.f1Score * 100).toFixed(2)}%`);
  console.log("==========================================");

  await mongoose.disconnect();
}

executeFreshRun().catch(console.error);
