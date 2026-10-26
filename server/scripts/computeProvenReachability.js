import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

// 1. Load A2 runtime trace
const tracePath = path.join(rootDir, "evidence/stage5/12-reachability-runtime-trace.json");
const traceData = JSON.parse(fs.readFileSync(tracePath, "utf-8"));

// 2. Definitive Proven Scenarios from B5 Integration Suite
// A scenario is PROVEN_FROM_DB only if a B5 test, seeding DB records alone, produced that scenarioId.
const PROVEN_DB_CASES = new Set([
  "CASE_6_PAID_GATEWAY_UNPAID_ORDER",
  "CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED",
  "CASE_19_AMOUNT_OR_CURRENCY_MISMATCH",
  "CASE_7_DUPLICATE_PAYMENT_ATTEMPTS",
  "CASE_12_FAILED_REFUND",
  "CASE_11_FULL_REFUND_INITIATED_NOT_COMPLETED",
  "CASE_10_PARTIAL_REFUND",
  "CASE_8_PARTIAL_CAPTURE",
  "CASE_20_DUPLICATE_SETTLEMENT_RECORD",
  "CASE_21_MISSING_SETTLEMENT_RECORD",
  "CASE_5_CAPTURED_PAYMENT_DELAYED_SETTLEMENT",
  "CASE_17_LOST_WEBHOOK",
  "CASE_26_WORKER_CRASH_ACTION_PENDING",
  "CASE_30_CHARGEBACK_OR_FORMAL_DISPUTE"
]);

// Ingestion-time checks (with file:line citations from ripgrep)
const INGESTION_TIME_CASES = {
  CASE_14_DUPLICATE_WEBHOOK_DELIVERY: "server/src/services/webhook/webhookService.js:210",
  CASE_15_FORGED_WEBHOOK: "server/src/services/webhook/webhookService.js:193",
  CASE_28_CROSS_TENANT_ACCESS_ATTEMPT: "server/src/middleware/authMiddleware.js:230"
};

// Scenarios requiring customer claim intake routes (out of scope for Stage 5)
const NEEDS_CLAIM_INTAKE_CASES = new Set([
  "CASE_2_CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING",
  "CASE_3_CUSTOMER_DEBIT_CLAIM_PAYMENT_FAILED",
  "CASE_29_FRAUD_ALLEGATION_UNAUTHORIZED_PAYMENT"
]);

// Transient / infrastructure failure scenarios where no persistent datastore or provider source exists
const NO_SOURCE_CASES = new Set([
  "CASE_24_PROVIDER_UNAVAILABLE_RATE_LIMITED",
  "CASE_25_DATABASE_OUTAGE_DURING_ACTION"
]);

// Build classified rows
const classifiedRows = traceData.map((item) => {
  const { caseNumber, scenarioId, readSet } = item;
  let category;
  let citation = null;

  if (PROVEN_DB_CASES.has(scenarioId)) {
    category = "PROVEN_FROM_DB";
  } else if (INGESTION_TIME_CASES[scenarioId]) {
    category = `INGESTION_TIME (${INGESTION_TIME_CASES[scenarioId]})`;
  } else if (NEEDS_CLAIM_INTAKE_CASES.has(scenarioId)) {
    category = "NEEDS_CLAIM_INTAKE";
  } else if (NO_SOURCE_CASES.has(scenarioId)) {
    category = "NO_SOURCE";
  } else {
    category = "RESERVED";
  }

  return {
    caseNumber,
    scenarioId,
    safeHoldCode: item.safeHoldCode,
    readSetCount: readSet.length,
    readSet,
    category
  };
});

// Compute category counts strictly in code
const categoryCounts = {};
for (const row of classifiedRows) {
  const baseCategory = row.category.split(" ")[0];
  categoryCounts[baseCategory] = (categoryCounts[baseCategory] || 0) + 1;
}

// Generate formatted text table
const header = `| Case # | Real Scenario ID | Read-Set Fields | Classification Category |
|:---|:---|:---|:---|`;

const lines = classifiedRows.map((r) => {
  const readSetSummary = `${r.readSetCount} fields [${r.readSet.slice(0, 3).join(", ")}...]`;
  return `| ${String(r.caseNumber).padStart(2, " ")} | \`${r.scenarioId}\` | ${readSetSummary} | **${r.category}** |`;
});

const summary = `
================================================================================
RECONAI 2.0 — STAGE 5B PROVEN REACHABILITY SUMMARY (CODE-COMPUTED)
================================================================================
Total Classification Scenarios Evaluated: ${classifiedRows.length}
- PROVEN_FROM_DB:     ${categoryCounts["PROVEN_FROM_DB"] || 0}
- INGESTION_TIME:     ${categoryCounts["INGESTION_TIME"] || 0}
- NEEDS_CLAIM_INTAKE: ${categoryCounts["NEEDS_CLAIM_INTAKE"] || 0}
- RESERVED:           ${categoryCounts["RESERVED"] || 0}
- NO_SOURCE:          ${categoryCounts["NO_SOURCE"] || 0}
================================================================================
`;

const tableOutput = `${header}\n${lines.join("\n")}\n\n${summary}`;

// Output files
const outJsonPath = path.join(rootDir, "evidence/stage5/25-proven-reachability.json");
const outTxtPath = path.join(rootDir, "evidence/stage5/25-proven-reachability.txt");

fs.writeFileSync(outJsonPath, JSON.stringify({ classifiedRows, categoryCounts }, null, 2), "utf-8");
fs.writeFileSync(outTxtPath, tableOutput, "utf-8");

console.log(tableOutput);
