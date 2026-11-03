import fs from "fs";
import path from "path";
import cp from "child_process";

// 1. Get files in dc73af9
const dcFiles = cp.execSync("git show --name-only --format= dc73af9", { encoding: "utf8" })
  .trim()
  .split("\n")
  .map(f => f.trim())
  .filter(Boolean);

// Files explicitly named in the Stage 6.5 prompt:
// Stage 6.5 tasked documentation cleanup and workspace browser verification.
// The documents explicitly named were:
// README.md, docs/reconai-2/EDGE_CASE_POLICY_MATRIX.md, docs/reconai-2/PHASE_6_CLASSIFICATION_ENGINE.md,
// docs/reconai-2/ROLE_PERMISSION_MATRIX.md, docs/reconai-2/ARCHITECTURE_DECISIONS.md,
// docs/reconai-2/DAILY_WORK_LOG_2026_10_12.md, docs/reconai-2/CURRENT_PROJECT_STATUS.md,
// docs/reconai-2/DOCUMENTATION_CONSISTENCY_AUDIT.md, docs/reconai-2/OPEN_DECISIONS_AND_TECHNICAL_DEBT.md.
const namedInStage65Prompt = new Set([
  "README.md",
  "docs/reconai-2/EDGE_CASE_POLICY_MATRIX.md",
  "docs/reconai-2/PHASE_6_CLASSIFICATION_ENGINE.md",
  "docs/reconai-2/ROLE_PERMISSION_MATRIX.md",
  "docs/reconai-2/ARCHITECTURE_DECISIONS.md",
  "docs/reconai-2/DAILY_WORK_LOG_2026_10_12.md",
  "docs/reconai-2/CURRENT_PROJECT_STATUS.md",
  "docs/reconai-2/DOCUMENTATION_CONSISTENCY_AUDIT.md",
  "docs/reconai-2/OPEN_DECISIONS_AND_TECHNICAL_DEBT.md"
]);

const unreviewedFiles = dcFiles.filter(f => !namedInStage65Prompt.has(f));

function categorize(filePath) {
  if (filePath.startsWith("server/src/")) return "Backend Application Source Code";
  if (filePath.startsWith("server/scripts/")) return "Backend Automation Scripts";
  if (filePath.startsWith("server/tests/")) return "Backend Test Suites";
  if (filePath.startsWith("client/src/")) return "Frontend Client Application Code";
  if (filePath.startsWith("client/")) return "Frontend Documentation";
  if (filePath.startsWith("docs/reconai-2/")) return "ReconAI 2.0 Specifications";
  if (filePath.startsWith("docs/")) return "Legacy Root Documentation";
  if (filePath.endsWith(".md")) return "Root Tracking Markdown Files";
  return "Other";
}

let report = "";
report += "=== RECONAI 2.0: AUDIT OF COMMIT dc73af9 UNREVIEWED FILES ===\n";
report += `Total files in commit dc73af9: ${dcFiles.length}\n`;
report += `Files named in Stage 6.5 prompt: ${namedInStage65Prompt.size}\n`;
report += `Files in commit NOT named in Stage 6.5 prompt: ${unreviewedFiles.length}\n\n`;

report += "CATEGORY BREAKDOWN BY PATH:\n";
const grouped = {};
for (const f of unreviewedFiles) {
  const cat = categorize(f);
  if (!grouped[cat]) grouped[cat] = [];
  grouped[cat].push(f);
}

for (const [cat, files] of Object.entries(grouped)) {
  report += `\n[${cat}] (${files.length} files):\n`;
  for (const f of files) {
    report += `  - ${f}\n`;
  }
}

report += "\nDETAILED FILE-BY-FILE AUDIT TABLE:\n";
report += "File | Category | Untracked at Stage 6.5 Start? | Prior Creation/Write Times | Transcript Origin Mention\n";
report += "-".repeat(120) + "\n";

// Baseline files from evidence/stage6_5/00-baseline.txt
const baselineModified = new Set([
  "README.md", "client/README.md", "docs/API.md", "docs/ARCHITECTURE.md",
  "docs/PROGRESS.md", "docs/TESTING.md", "docs/reconai-2/ACCEPTANCE_CRITERIA.md",
  "docs/reconai-2/ARCHITECTURE_DECISIONS.md", "docs/reconai-2/DAILY_WORK_LOG_2026_10_12.md",
  "docs/reconai-2/EDGE_CASE_POLICY_MATRIX.md", "docs/reconai-2/PAYMENT_STATE_MACHINE.md",
  "docs/reconai-2/PRODUCT_REQUIREMENTS.md", "docs/reconai-2/PROVIDER_CAPABILITY_MATRIX.md",
  "docs/reconai-2/ROLE_PERMISSION_MATRIX.md", "folderstr.md", "implemented.md", "memory.md"
]);
const baselineUntracked = new Set([
  "docs/reconai-2/CURRENT_PROJECT_STATUS.md",
  "docs/reconai-2/DOCUMENTATION_CONSISTENCY_AUDIT.md",
  "docs/reconai-2/OPEN_DECISIONS_AND_TECHNICAL_DEBT.md"
]);

for (const f of unreviewedFiles) {
  const cat = categorize(f);
  const wasUntracked = !baselineModified.has(f);
  let times = "N/A";
  try {
    const st = fs.statSync(f);
    times = `Created: ${st.birthtime.toISOString().slice(0, 19)} | Modified: ${st.mtime.toISOString().slice(0, 19)}`;
  } catch (e) {}

  report += `${f} | ${cat} | ${wasUntracked ? "YES (Untracked)" : "NO (Pre-existing in tree)"} | ${times} | UNKNOWN\n`;
}

report += "\nPROVENANCE STATEMENT:\n";
report += "These files were present in the working tree when commit dc73af9 was executed.\n";
report += "They were not specified by the Stage 6.5 prompt and were committed without review.\n";
report += "The exact authoring origin of untracked files prior to commit dc73af9 is UNKNOWN from repository transcripts.\n";

fs.writeFileSync("evidence/stage8/01-commit-provenance-analysis.txt", report, "utf8");
console.log(report);
console.log("\nSaved provenance analysis to evidence/stage8/01-commit-provenance-analysis.txt");

