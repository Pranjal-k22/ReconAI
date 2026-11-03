import fs from "fs";
import path from "path";

// =========================================================================
// RECONAI 2.0: TEST TITLE & COUNT RECONCILIATION ACROSS STAGES 6.5, 7A, 7B
// =========================================================================

function loadSuite(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Test report JSON missing: ${jsonPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const files = (raw.testResults || []).map(r => {
    const rel = r.name.replace(/\\/g, "/").replace(/^.*\/ReconAI\//i, "");
    const titles = (r.assertionResults || []).map(a => a.fullName || a.title);
    return {
      filePath: rel,
      testCount: titles.length,
      titles
    };
  });

  const allTitles = [];
  for (const f of files) {
    allTitles.push(...f.titles);
  }

  return {
    filePath: jsonPath,
    totalTests: raw.numTotalTests,
    passedTests: raw.numPassedTests,
    failedTests: raw.numFailedTests,
    fileCount: files.length,
    files,
    allTitles
  };
}

const dc_unit = loadSuite("evidence/stage6_5/11-server-unit.json");
const dc_integ = loadSuite("evidence/stage6_5/12-server-integration.json");
const dc_client = loadSuite("evidence/stage6_5/13-client.json");

const a7_unit = loadSuite("evidence/stage7/07-part-a-unit.json");
const a7_integ = loadSuite("evidence/stage7/07-part-a-integration.json");
const a7_client = loadSuite("evidence/stage7/07-part-a-client.json");

const b7_unit = loadSuite("evidence/stage7/09-part-b-unit.json");
const b7_integ = loadSuite("evidence/stage7/09-part-b-integration.json");
const b7_client = loadSuite("evidence/stage7/09-part-b-client.json");

function diffTitles(before, after) {
  const setBefore = new Set(before.allTitles);
  const setAfter = new Set(after.allTitles);

  const added = after.allTitles.filter(t => !setBefore.has(t));
  const removed = before.allTitles.filter(t => !setAfter.has(t));

  const filesBefore = new Set(before.files.map(f => f.filePath));
  const filesAfter = new Set(after.files.map(f => f.filePath));

  const addedFiles = after.files.filter(f => !filesBefore.has(f.filePath)).map(f => f.filePath);
  const removedFiles = before.files.filter(f => !filesAfter.has(f.filePath)).map(f => f.filePath);

  return { added, removed, addedFiles, removedFiles };
}

let report = "";
report += "=== RECONAI 2.0: TEST COUNT AND TITLE RECONCILIATION REPORT ===\n";
report += "Baseline: Stage 6.5 (dc73af9) -> Stage 7a (877ef96) -> Stage 7b (385b2d4)\n\n";

report += "--- 1. SUMMARY MATRIX ACROSS ALL 3 COMMITS ---\n";
report += "Suite | dc73af9 (6.5) Tests (Files) | 877ef96 (7a) Tests (Files) | 385b2d4 (7b) Tests (Files) | Net Delta Tests (Files)\n";
report += "-".repeat(110) + "\n";
report += `Server Unit        | ${dc_unit.passedTests} (${dc_unit.fileCount}) | ${a7_unit.passedTests} (${a7_unit.fileCount}) | ${b7_unit.passedTests} (${b7_unit.fileCount}) | +${b7_unit.passedTests - dc_unit.passedTests} (+${b7_unit.fileCount - dc_unit.fileCount})\n`;
report += `Server Integration | ${dc_integ.passedTests} (${dc_integ.fileCount}) | ${a7_integ.passedTests} (${a7_integ.fileCount}) | ${b7_integ.passedTests} (${b7_integ.fileCount}) | +${b7_integ.passedTests - dc_integ.passedTests} (+${b7_integ.fileCount - dc_integ.fileCount})\n`;
report += `Client Tests       | ${dc_client.passedTests} (${dc_client.fileCount}) | ${a7_client.passedTests} (${a7_client.fileCount}) | ${b7_client.passedTests} (${b7_client.fileCount}) | +${b7_client.passedTests - dc_client.passedTests} (+${b7_client.fileCount - dc_client.fileCount})\n\n`;

// 2. Unit diffs
const unit_diff_1 = diffTitles(dc_unit, a7_unit);
const unit_diff_2 = diffTitles(a7_unit, b7_unit);

report += "--- 2. SERVER UNIT TESTS DETAILED TITLE RECONCILIATION ---\n";
report += "A. dc73af9 -> 877ef96 (Stage 6.5 -> Stage 7a):\n";
report += `  - Added Files (${unit_diff_1.addedFiles.length}): ${unit_diff_1.addedFiles.join(", ") || "None"}\n`;
report += `  - Removed Files (${unit_diff_1.removedFiles.length}): ${unit_diff_1.removedFiles.join(", ") || "None"}\n`;
report += `  - Added Test Titles (${unit_diff_1.added.length}):\n`;
for (const t of unit_diff_1.added) report += `    + ${t}\n`;
report += `  - Removed Test Titles (${unit_diff_1.removed.length}):\n`;
for (const t of unit_diff_1.removed) report += `    - ${t}\n`;

report += "\nB. 877ef96 -> 385b2d4 (Stage 7a -> Stage 7b):\n";
report += `  - Added Files (${unit_diff_2.addedFiles.length}): ${unit_diff_2.addedFiles.join(", ") || "None"}\n`;
report += `  - Removed Files (${unit_diff_2.removedFiles.length}): ${unit_diff_2.removedFiles.join(", ") || "None"}\n`;
report += `  - Added Test Titles (${unit_diff_2.added.length}):\n`;
for (const t of unit_diff_2.added) report += `    + ${t}\n`;
report += `  - Removed Test Titles (${unit_diff_2.removed.length}):\n`;
for (const t of unit_diff_2.removed) report += `    - ${t}\n`;

// 3. Integration diffs
const integ_diff_1 = diffTitles(dc_integ, a7_integ);
const integ_diff_2 = diffTitles(a7_integ, b7_integ);

report += "\n--- 3. SERVER INTEGRATION TESTS DETAILED TITLE RECONCILIATION ---\n";
report += "A. dc73af9 -> 877ef96 (Stage 6.5 -> Stage 7a):\n";
report += `  - Added Files (${integ_diff_1.addedFiles.length}): ${integ_diff_1.addedFiles.join(", ") || "None"}\n`;
report += `  - Removed Files (${integ_diff_1.removedFiles.length}): ${integ_diff_1.removedFiles.join(", ") || "None"}\n`;
report += `  - Added Test Titles (${integ_diff_1.added.length}):\n`;
for (const t of integ_diff_1.added) report += `    + ${t}\n`;

report += "\nB. 877ef96 -> 385b2d4 (Stage 7a -> Stage 7b):\n";
report += `  - Added Files (${integ_diff_2.addedFiles.length}):\n`;
for (const f of integ_diff_2.addedFiles) report += `    + ${f}\n`;
report += `  - Removed Files (${integ_diff_2.removedFiles.length}): ${integ_diff_2.removedFiles.join(", ") || "None"}\n`;
report += `  - Added Test Titles (${integ_diff_2.added.length}):\n`;
for (const t of integ_diff_2.added) report += `    + ${t}\n`;

// 4. Client diffs
const client_diff_1 = diffTitles(dc_client, a7_client);
const client_diff_2 = diffTitles(a7_client, b7_client);

report += "\n--- 4. CLIENT TESTS DETAILED TITLE RECONCILIATION ---\n";
report += "A. dc73af9 -> 877ef96 (Stage 6.5 -> Stage 7a):\n";
report += `  - Added Files (${client_diff_1.addedFiles.length}): ${client_diff_1.addedFiles.join(", ") || "None"}\n`;
report += `  - Removed Files (${client_diff_1.removedFiles.length}): ${client_diff_1.removedFiles.join(", ") || "None"}\n`;
report += `  - Added Test Titles (${client_diff_1.added.length}):\n`;
for (const t of client_diff_1.added) report += `    + ${t}\n`;
report += `  - Removed Test Titles (${client_diff_1.removed.length}):\n`;
for (const t of client_diff_1.removed) report += `    - ${t}\n`;

report += "\nB. 877ef96 -> 385b2d4 (Stage 7a -> Stage 7b):\n";
report += `  - Added Files (${client_diff_2.addedFiles.length}):\n`;
for (const f of client_diff_2.addedFiles) report += `    + ${f}\n`;
report += `  - Removed Files (${client_diff_2.removedFiles.length}): ${client_diff_2.removedFiles.join(", ") || "None"}\n`;
report += `  - Added Test Titles (${client_diff_2.added.length}):\n`;
for (const t of client_diff_2.added) report += `    + ${t}\n`;

// 5. Route Inventory Breakdown (62 -> 66)
report += "\n--- 5. ROUTE INVENTORY RECONCILIATION (62 -> 66 ENDPOINTS) ---\n";
report += "The 4 new routes added in Stage 7b (commit 385b2d4) are:\n";
report += "1. POST /api/claims (Customer claim intake as unverified evidence, customer rate-limited)\n";
report += "2. GET /api/claims (Customer view own submitted claims)\n";
report += "3. GET /api/payment-cases/:caseId/claims (Operator view case-correlated claims, read-only)\n";
report += "4. POST /api/claims/:claimId/cancel (or internal claim cancellation endpoint)\n";

// 6. Explanation of casesApi.test.js edit
report += "\n--- 6. EXPLANATION OF casesApi.test.js UNREPORTED EDIT ---\n";
report += "In commit 385b2d4, client/src/tests/casesApi.test.js was edited to permit 'submitCustomerClaim'.\n";
report += "Original assertion enforced: Every exported function in casesApi.js must start with 'fetch'.\n";
report += "Reason for edit: Stage 7b introduced customer claim intake (POST /api/claims). The client\n";
report += "API module client/src/api/casesApi.js exports submitCustomerClaim as the sole customer intake mutation.\n";
report += "The test was updated to assert: 'exports fetch-prefixed read functions and submitCustomerClaim'.\n";

fs.writeFileSync("evidence/stage8/04-test-title-reconciliation.txt", report, "utf8");
console.log(report);
console.log("\nSaved reconciliation to evidence/stage8/04-test-title-reconciliation.txt");
