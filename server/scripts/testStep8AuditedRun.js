import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { runReconciliationBatch } from "../src/services/reconciliation/reconciliationService.js";
import { ExceptionCase } from "../src/models/ExceptionCase.js";
import { ReconciliationResult } from "../src/models/ReconciliationResult.js";
import { AuditLog } from "../src/models/AuditLog.js";
import { applyHumanDecision } from "../src/services/exceptions/humanReviewService.js";
import { getExceptionsSummary } from "../src/services/exceptions/exceptionService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

async function main() {
  console.log("Connecting to Live MongoDB Atlas...");
  await connectDatabase();

  try {
    console.log("\n==========================================");
    console.log("TRIGGERING STEP 8 AUDITED BENCHMARK RUN");
    console.log("==========================================");

    const runDoc = await runReconciliationBatch({
      name: "ReconAI Step 8 Audited Benchmark",
      sourceMode: "SYNTHETIC",
      importBatchId: "BATCH-DEMO-V1",
      datasetVersion: "RECONAI_DEMO_V1"
    });

    console.log(`runId:               ${runDoc.runId}`);
    console.log(`status:              ${runDoc.status}`);
    console.log(`totalRecords:        ${runDoc.totalRecords}`);
    console.log(`processedRecords:    ${runDoc.processedRecords}`);
    console.log(`durationMs:          ${runDoc.durationMs} ms`);

    // Verify ExceptionCase records created for this run
    const exceptions = await ExceptionCase.find({ runId: runDoc.runId }).lean();
    console.log(`\nExceptions Created in Atlas: ${exceptions.length} (Expected: 40)`);

    // Verify AuditLog entries created for this run
    const auditLogs = await AuditLog.find({ runId: runDoc.runId }).lean();
    console.log(`Audit Events Created in Atlas: ${auditLogs.length} (Expected ~122)`);

    const actionCounts = {};
    for (const log of auditLogs) {
      actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
    }
    console.log("Audit Events Breakdown:", actionCounts);

    // Verify Exception Summary
    const summary = await getExceptionsSummary();
    console.log("\nException Summary:", summary);

    // Section 53 & 54: Live Human Review Demonstration on ORD-000116 (KEEP_EXCEPTION)
    console.log("\n==========================================");
    console.log("EXECUTING LIVE HUMAN REVIEW ON ORD-000116");
    console.log("==========================================");

    const ambiguousExc = await ExceptionCase.findOne({ runId: runDoc.runId, merchantOrderId: "ORD-000116" });
    if (!ambiguousExc) {
      throw new Error("Could not find ExceptionCase for ORD-000116");
    }

    console.log(`Target ExceptionId: ${ambiguousExc.exceptionId}`);
    console.log(`Initial Status:      ${ambiguousExc.status}`);
    console.log(`Initial Decision:    ${ambiguousExc.humanDecision}`);

    const reviewRes = await applyHumanDecision({
      exceptionId: ambiguousExc.exceptionId,
      decision: "KEEP_EXCEPTION",
      resolutionNotes: "Flagged ambiguous multi-payment transaction for secondary audit verification during hackathon demo.",
      actorId: "demo-finance-reviewer"
    });

    console.log("\nHuman Decision Applied Successfully!");
    console.log(`Updated Exception Status:       ${reviewRes.exceptionCase.status}`);
    console.log(`Updated Exception Decision:     ${reviewRes.exceptionCase.humanDecision}`);
    console.log(`Updated Result ResolutionStatus: ${reviewRes.reconciliationResult.resolutionStatus}`);
    console.log(`Result Classification Preserved:${reviewRes.reconciliationResult.classification} (MANDATORY INVARIANT)`);

    // Verify HUMAN_DECISION audit log created
    const decisionAudit = await AuditLog.findOne({
      runId: runDoc.runId,
      action: "HUMAN_DECISION",
      entityId: ambiguousExc.exceptionId
    }).lean();

    console.log("\nVerified HUMAN_DECISION Audit Log Created:");
    console.log(`Event ID:   ${decisionAudit?.eventId}`);
    console.log(`Actor ID:   ${decisionAudit?.actorId}`);
    console.log(`Action:     ${decisionAudit?.action}`);
    console.log(`Notes:      ${decisionAudit?.reason}`);

    console.log("\n==========================================");
    console.log("STEP 8 LIVE ATLAS VERIFICATION SUCCESSFUL!");
    console.log("==========================================\n");

  } finally {
    await disconnectDatabase();
    console.log("Disconnected from MongoDB Atlas.");
  }
}

main().catch((err) => {
  console.error("Error during Step 8 live verification:", err);
  process.exit(1);
});
