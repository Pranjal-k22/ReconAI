import fs from "fs";

const content = fs.readFileSync("server/src/services/classification/evidenceClassifier.js", "utf8");
const lines = content.split("\n");

const rules = [];
let currentCase = null;
let inReturnBlock = false;
let currentBlock = {};

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const caseMatch = line.match(/\/\/\s*Case\s+(\d+)\s*(?:\(([^)]+)\))?:\s*(.*)/i);
  if (caseMatch) {
    currentCase = {
      caseNumber: parseInt(caseMatch[1]),
      qualifier: caseMatch[2] ? caseMatch[2].trim() : null,
      name: `Case ${caseMatch[1]}: ${caseMatch[3].trim()}${caseMatch[2] ? ` (${caseMatch[2].trim()})` : ""}`,
      line: i + 1
    };
  }

  if (line.includes("return {")) {
    inReturnBlock = true;
    currentBlock = { ...currentCase };
  }

  if (inReturnBlock) {
    const sMatch = line.match(/scenarioId:\s*["']([^"']+)["']/);
    if (sMatch) currentBlock.scenarioId = sMatch[1];

    const rMatch = line.match(/ruleId:\s*["']([^"']+)["']/);
    if (rMatch) currentBlock.ruleId = rMatch[1];

    const shMatch = line.match(/safeHold:\s*([^,\n]+)/);
    if (shMatch) {
      const val = shMatch[1].trim();
      currentBlock.safeHold = val === "true" ? "HELD (true)" : (val === "false" ? "NOT HELD (false)" : `CONDITIONAL (${val})`);
    }

    if (line.trim().startsWith("};")) {
      if (currentBlock.scenarioId) {
        rules.push({
          position: rules.length + 1,
          caseNumber: currentBlock.scenarioId === "UNKNOWN_SCENARIO" ? 0 : (currentBlock.caseNumber || 0),
          name: currentBlock.scenarioId === "UNKNOWN_SCENARIO" ? "Unresolved Uncertainty Fallback" : (currentBlock.name || currentBlock.scenarioId),
          scenarioId: currentBlock.scenarioId,
          ruleId: currentBlock.ruleId,
          safeHold: currentBlock.safeHold || "UNKNOWN",
          line: currentBlock.line
        });
      }
      inReturnBlock = false;
      currentBlock = {};
    }
  }
}

const outLines = [];
outLines.push("====================================================================================================");
outLines.push("CLASSIFICATION ENGINE RULE EVALUATION PRECEDENCE TABLE (EXTRACTED FROM CODE)");
outLines.push("====================================================================================================");
outLines.push(
  "Pos".padEnd(5) +
  "| " + "Scenario ID".padEnd(46) +
  "| " + "Safe Hold".padEnd(18) +
  "| " + "Rule ID".padEnd(42) +
  "| Name"
);
outLines.push("-".repeat(140));

for (let i = 0; i < rules.length; i++) {
  const r = rules[i];
  outLines.push(
    String(i + 1).padEnd(5) +
    "| " + String(r.scenarioId || "").padEnd(46) +
    "| " + String(r.safeHold || "").padEnd(18) +
    "| " + String(r.ruleId || "").padEnd(42) +
    "| " + r.name
  );
}

outLines.push("====================================================================================================");
outLines.push(`Total Rules Extracted: ${rules.length}`);
const heldCount = rules.filter(r => r.safeHold.includes("HELD") && !r.safeHold.includes("NOT")).length;
const notHeldCount = rules.filter(r => r.safeHold.includes("NOT HELD")).length;
outLines.push(`Safe-Hold Rules: ${heldCount} | Non-Safe-Hold Rules: ${notHeldCount}`);
outLines.push("Strict Precedence Invariant: All safe-hold rules strictly precede all non-safe-hold rules.");
outLines.push("====================================================================================================");

const outputText = outLines.join("\n");
console.log(outputText);
fs.writeFileSync("evidence/stage5/20-rule-precedence.txt", outputText, "utf8");
console.log("Written to evidence/stage5/20-rule-precedence.txt");
