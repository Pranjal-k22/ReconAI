import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { runReconciliationBatch, getReconciliationRunById, getRunResults } from "../src/services/reconciliation/reconciliationService.js";
import { evaluateReconciliationRun } from "../src/services/evaluation/evaluationService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

async function main() {
  console.log("Connecting to Live MongoDB Atlas...");
  await connectDatabase();

  try {
    console.log("Triggering Live Batch Reconciliation Run...");
    const runDoc = await runReconciliationBatch({
      name: "ReconAI Step 7 Live Benchmark",
      sourceMode: "SYNTHETIC",
      importBatchId: "BATCH-DEMO-V1",
      datasetVersion: "RECONAI_DEMO_V1"
    });

    console.log("\n==========================================");
    console.log("LIVE BATCH RECONCILIATION RUN COMPLETED");
    console.log("==========================================");
    console.log(`runId:               ${runDoc.runId}`);
    console.log(`status:              ${runDoc.status}`);
    console.log(`totalRecords:        ${runDoc.totalRecords}`);
    console.log(`processedRecords:    ${runDoc.processedRecords}`);
    console.log(`durationMs:          ${runDoc.durationMs} ms`);

    const metrics = runDoc.metrics || {};
    console.log("\n--- OPERATIONAL METRICS ---");
    console.log(`matchedCount:                ${metrics.matchedCount}`);
    console.log(`exceptionCount:              ${metrics.exceptionCount}`);
    console.log(`autoReconciledCount:         ${metrics.autoReconciledCount}`);
    console.log(`manualReviewCount:           ${metrics.manualReviewCount}`);
    console.log(`autoReconciliationRate:      ${(metrics.autoReconciliationRate * 100).toFixed(2)}%`);
    console.log(`throughputRecordsPerSecond:  ${metrics.throughputRecordsPerSecond.toFixed(2)} rec/s`);
    console.log(`totalAmountProcessedPaise:   ₹${(metrics.totalAmountProcessedPaise / 100).toFixed(2)}`);
    console.log(`autoReconciledAmountPaise:   ₹${(metrics.autoReconciledAmountPaise / 100).toFixed(2)}`);
    console.log(`amountUnderReviewPaise:      ₹${(metrics.amountUnderReviewPaise / 100).toFixed(2)}`);
    console.log("Classification Breakdown:", metrics.classificationBreakdown);

    console.log("\nFetching Persisted Results from Atlas...");
    const { results, pagination } = await getRunResults(runDoc.runId, { page: 1, limit: 120 });
    console.log(`Fetched ${results.length} persisted results (Total in DB: ${pagination.total}).`);

    console.log("\nRunning GroundTruth Evaluation on Live Run...");
    const evalReport = await evaluateReconciliationRun(runDoc.runId, "RECONAI_DEMO_V1");

    console.log("\n==========================================");
    console.log("LIVE BENCHMARK EVALUATION REPORT");
    console.log("==========================================");
    console.log(`Total Scenarios Evaluated: ${evalReport.totalScenarios}`);
    console.log(`Correct Classifications:   ${evalReport.correctClassifications}`);
    console.log(`Incorrect Classifications: ${evalReport.incorrectClassifications}`);
    console.log(`Classification Accuracy:   ${(evalReport.classificationAccuracy * 100).toFixed(2)}%`);
    console.log(`Precision:                 ${(evalReport.exceptionDetection.precision * 100).toFixed(2)}%`);
    console.log(`Recall:                    ${(evalReport.exceptionDetection.recall * 100).toFixed(2)}%`);
    console.log(`F1 Score:                  ${(evalReport.exceptionDetection.f1Score * 100).toFixed(2)}%`);
    console.log("==========================================\n");

  } finally {
    await disconnectDatabase();
    console.log("Disconnected from MongoDB Atlas.");
  }
}

main().catch((err) => {
  console.error("Error in live verification script:", err);
  process.exit(1);
});
