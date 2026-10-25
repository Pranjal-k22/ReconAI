import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { classifyPaymentScenario } from "../src/services/classification/evidenceClassifier.js";
import { CLASSIFICATION_SCENARIOS } from "../tests/helpers/classificationScenarios.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

// 1. Read EDGE_CASE_POLICY_MATRIX.md headings
const matrixPath = path.join(rootDir, "docs/reconai-2/EDGE_CASE_POLICY_MATRIX.md");
const matrixContent = fs.readFileSync(matrixPath, "utf8");
const matrixHeadings = {};
const matrixRegex = /^### Case (\d+):\s*(.*)$/gm;
let mMatch;
while ((mMatch = matrixRegex.exec(matrixContent)) !== null) {
  matrixHeadings[parseInt(mMatch[1], 10)] = mMatch[2].trim();
}

// 2. Read PHASE_6_CLASSIFICATION_ENGINE.md table
const phase6Path = path.join(rootDir, "docs/reconai-2/PHASE_6_CLASSIFICATION_ENGINE.md");
const phase6Content = fs.readFileSync(phase6Path, "utf8");
const phase6Cases = {};
// Table rows: | # | Scenario ID | Discrepancy Category | Reason Code | Deterministic Rule ID | Authoritative Evidence | Facts vs. Claims Distinction | Safe Hold Code | Recommendation | Test Coverage |
const p6Lines = phase6Content.split("\n");
for (const line of p6Lines) {
  const trimmed = line.trim();
  if (trimmed.startsWith("|") && !trimmed.includes("Scenario ID") && !trimmed.includes("---")) {
    const parts = trimmed.split("|").map(p => p.trim()).filter(Boolean);
    if (parts.length >= 8 && /^\d+$/.test(parts[0])) {
      const caseNum = parseInt(parts[0], 10);
      phase6Cases[caseNum] = {
        scenarioId: parts[1].replace(/`/g, ""),
        category: parts[2].replace(/`/g, ""),
        reasonCode: parts[3].replace(/`/g, ""),
        safeHoldCode: parts[7].replace(/`/g, "")
      };
    }
  }
}

// 3. Run real classifier on real fixtures
let heldCount = 0;
let notHeldCount = 0;

console.log("=== REAL CLASSIFIER OUTPUT FOR ALL 30 SCENARIOS ===");
console.log("| Case # | Scenario ID | Category | Reason Code | Safe Hold | Safe Hold Code |");
console.log("|:---:|:---|:---|:---|:---:|:---|");

const results = [];

for (const fixture of CLASSIFICATION_SCENARIOS) {
  const finding = classifyPaymentScenario(fixture.input);
  if (finding.safeHold) {
    heldCount++;
  } else {
    notHeldCount++;
  }

  results.push({
    caseNum: fixture.caseNum,
    scenarioId: finding.scenarioId,
    category: finding.category,
    reasonCode: finding.reasonCode,
    safeHold: finding.safeHold,
    safeHoldCode: finding.safeHoldCode,
    expectedScenarioId: fixture.scenarioId,
    expectedSafeHold: fixture.expectedSafeHold,
    expectedSafeHoldCode: fixture.expectedSafeHoldCode
  });

  console.log(`| ${fixture.caseNum} | ${finding.scenarioId} | ${finding.category} | ${finding.reasonCode} | ${finding.safeHold} | ${finding.safeHoldCode} |`);
}

console.log("\n=== COMPUTED TOTALS ===");
console.log(`Held (safeHold === true): ${heldCount}`);
console.log(`Not Held (safeHold === false): ${notHeldCount}`);
console.log(`Total: ${heldCount + notHeldCount}`);

// 4. Detailed comparison against EDGE_CASE_POLICY_MATRIX and PHASE_6_CLASSIFICATION_ENGINE
console.log("\n=== COMPARISON AGAINST MATRIX HEADING AND PHASE 6 DOC ===");
console.log("| Case # | Matrix Heading Title | Classifier Scenario ID | Doc Scenario ID | Doc Safe Hold Code | Emitted Safe Hold Code | Safe Hold Match? | Scenario ID Match? |");
console.log("|:---:|:---|:---|:---|:---|:---|:---:|:---:|");

const mismatches = [];

for (const r of results) {
  const mTitle = matrixHeadings[r.caseNum] || "MISSING";
  const p6 = phase6Cases[r.caseNum] || { scenarioId: "MISSING", safeHoldCode: "MISSING" };
  
  const idMatch = r.scenarioId === p6.scenarioId;
  // In doc, safeHoldCode might be "NONE / CUSTOMER_DEBIT_ON_GATEWAY_PENDING (if >= 60m)" or exact
  const docCode = p6.safeHoldCode;
  const emittedCode = r.safeHoldCode;
  const codeMatches = docCode === emittedCode || docCode.includes(emittedCode);

  if (!idMatch || !codeMatches) {
    mismatches.push({
      caseNum: r.caseNum,
      matrixTitle: mTitle,
      classifierId: r.scenarioId,
      docScenarioId: p6.scenarioId,
      docCode: docCode,
      codeActuallyEmitted: emittedCode,
      idMatch,
      codeMatches
    });
  }

  console.log(`| ${r.caseNum} | ${mTitle} | ${r.scenarioId} | ${p6.scenarioId} | ${docCode} | ${emittedCode} | ${codeMatches ? "YES" : "NO"} | ${idMatch ? "YES" : "NO"} |`);
}

console.log("\n=== MISMATCHES FOUND ===");
if (mismatches.length === 0) {
  console.log("Zero mismatches found!");
} else {
  for (const m of mismatches) {
    console.log(`Case ${m.caseNum}:`);
    console.log(`  Matrix Title: ${m.matrixTitle}`);
    console.log(`  Classifier ID: ${m.classifierId} vs Doc ID: ${m.docScenarioId} (Match: ${m.idMatch})`);
    console.log(`  Doc Safe Hold Code: ${m.docCode}`);
    console.log(`  Emitted Safe Hold Code: ${m.codeActuallyEmitted}`);
  }
}
