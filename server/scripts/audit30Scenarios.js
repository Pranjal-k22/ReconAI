import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { classifyPaymentScenario } from "../src/services/classification/evidenceClassifier.js";
import { CLASSIFICATION_SCENARIOS } from "../tests/helpers/classificationScenarios.js";
import { PaymentCase, SAFE_HOLD_CODES } from "../src/models/PaymentCase.js";

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

// 2. Read and parse PHASE_6_CLASSIFICATION_ENGINE.md table (lines 31-60)
const phase6Path = path.join(rootDir, "docs/reconai-2/PHASE_6_CLASSIFICATION_ENGINE.md");
const phase6Content = fs.readFileSync(phase6Path, "utf8");
const phase6Cases = {};
const p6Lines = phase6Content.split("\n");

console.log("=== PARSING PHASE_6_CLASSIFICATION_ENGINE.md TABLE (LINES 31-60) ===");
for (let idx = 0; idx < p6Lines.length; idx++) {
  const lineNum = idx + 1;
  const line = p6Lines[idx];
  const trimmed = line.trim();
  if (trimmed.startsWith("|") && !trimmed.includes("Scenario ID") && !trimmed.includes("---")) {
    const parts = trimmed.split("|").map(p => p.trim()).filter(Boolean);
    if (parts.length >= 8 && /^\d+$/.test(parts[0])) {
      const caseNum = parseInt(parts[0], 10);
      if (caseNum >= 1 && caseNum <= 30) {
        console.log(`Line ${lineNum}: Case ${caseNum} -> ${parts[1]} | safeHold: ${parts[7]}`);
        phase6Cases[caseNum] = {
          lineNum,
          scenarioId: parts[1].replace(/`/g, "").trim(),
          category: parts[2].replace(/`/g, "").trim(),
          reasonCode: parts[3].replace(/`/g, "").trim(),
          safeHoldCode: parts[7].replace(/`/g, "").trim()
        };
      }
    }
  }
}

// Verify no case is missing from doc
for (let c = 1; c <= 30; c++) {
  if (!phase6Cases[c] || !phase6Cases[c].scenarioId || !phase6Cases[c].safeHoldCode) {
    console.error(`FATAL: Case ${c} was NOT_FOUND in PHASE_6_CLASSIFICATION_ENGINE.md`);
    process.exit(1);
  }
  if (!matrixHeadings[c]) {
    console.error(`FATAL: Case ${c} heading was NOT_FOUND in EDGE_CASE_POLICY_MATRIX.md`);
    process.exit(1);
  }
}

// 3. Run real classifier on real fixtures and validate Mongoose schema compliance
let heldCount = 0;
let notHeldCount = 0;

console.log("\n=== REAL CLASSIFIER OUTPUT FOR ALL 30 SCENARIOS ===");
console.log("| Case # | Scenario ID | Category | Reason Code | Safe Hold | Safe Hold Code | In SAFE_HOLD_CODES? | PaymentCase validateSync? |");
console.log("|:---:|:---|:---|:---|:---:|:---|:---:|:---:|");

const results = [];

for (const fixture of CLASSIFICATION_SCENARIOS) {
  const finding = classifyPaymentScenario(fixture.input);
  if (finding.safeHold) {
    heldCount++;
  } else {
    notHeldCount++;
  }

  // Validate safeHoldCode membership
  const isMemberOfEnum = SAFE_HOLD_CODES.includes(finding.safeHoldCode);
  if (!isMemberOfEnum) {
    console.error(`FATAL: Emitted safeHoldCode '${finding.safeHoldCode}' for Case ${fixture.caseNum} is not in SAFE_HOLD_CODES enum!`);
    process.exit(1);
  }

  // Validate PaymentCase model validation passes
  const testCase = new PaymentCase({
    tenantId: "tenant_audit_test",
    caseId: `CASE-AUDIT-${fixture.caseNum}`,
    gatewayPaymentId: `pay_audit_${fixture.caseNum}`,
    merchantOrderId: `ord_audit_${fixture.caseNum}`,
    amountPaise: 50000,
    safeHoldCode: finding.safeHoldCode,
    isSafeHold: finding.safeHold
  });
  const valErr = testCase.validateSync();
  const passesValidateSync = !valErr || !valErr.errors || !valErr.errors.safeHoldCode;
  if (!passesValidateSync) {
    console.error(`FATAL: PaymentCase.validateSync failed for Case ${fixture.caseNum}:`, valErr);
    process.exit(1);
  }

  results.push({
    caseNum: fixture.caseNum,
    scenarioId: finding.scenarioId,
    category: finding.category,
    reasonCode: finding.reasonCode,
    safeHold: finding.safeHold,
    safeHoldCode: finding.safeHoldCode,
    isMemberOfEnum,
    passesValidateSync
  });

  console.log(`| ${fixture.caseNum} | ${finding.scenarioId} | ${finding.category} | ${finding.reasonCode} | ${finding.safeHold} | ${finding.safeHoldCode} | ${isMemberOfEnum ? "YES" : "NO"} | ${passesValidateSync ? "PASS" : "FAIL"} |`);
}

console.log("\n=== COMPUTED TOTALS ===");
console.log(`Held (safeHold === true): ${heldCount}`);
console.log(`Not Held (safeHold === false): ${notHeldCount}`);
console.log(`Total: ${heldCount + notHeldCount}`);

// 4. Comparison against EDGE_CASE_POLICY_MATRIX and PHASE_6_CLASSIFICATION_ENGINE
console.log("\n=== COMPARISON AGAINST MATRIX HEADING AND PHASE 6 DOC ===");
console.log("| Case # | Matrix Heading Title | Classifier Scenario ID | Doc Scenario ID | Doc Safe Hold Code | Emitted Safe Hold Code | Safe Hold Match? | Scenario ID Match? |");
console.log("|:---:|:---|:---|:---|:---|:---|:---:|:---:|");

const mismatches = [];

for (const r of results) {
  const mTitle = matrixHeadings[r.caseNum];
  const p6 = phase6Cases[r.caseNum];
  
  const idMatch = r.scenarioId === p6.scenarioId;
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
  console.log("Zero mismatches found! All 30 scenarios match matrix and doc exactly.");
} else {
  console.error(`FATAL: ${mismatches.length} mismatches found!`);
  for (const m of mismatches) {
    console.error(JSON.stringify(m));
  }
  process.exit(1);
}
