import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

const classifierPath = path.join(rootDir, "server/src/services/classification/evidenceClassifier.js");
const classifierSource = fs.readFileSync(classifierPath, "utf8");

// Extract all context.foo properties read in evidenceClassifier.js
const contextProps = new Set();
const matches = classifierSource.matchAll(/context(?:\?\.|(?:\.))([a-zA-Z0-9_]+)/g);
for (const m of matches) {
  contextProps.add(m[1]);
}

console.log("=== CONTEXT FIELDS READ BY CLASSIFIER ===");
const sortedProps = Array.from(contextProps).sort();
console.log(`Total unique context properties read: ${sortedProps.length}`);

const productionSetProps = new Set();
const neverSetProps = [];

for (const prop of sortedProps) {
  try {
    const grepOutput = execSync(`git grep -n "${prop}" -- server/src`, { cwd: rootDir, encoding: "utf8" });
    const lines = grepOutput.split("\n").filter(l => l && !l.includes("evidenceClassifier.js"));
    if (lines.length > 0) {
      productionSetProps.add(prop);
      console.log(`[SET IN PRODUCTION] ${prop} -> ${lines[0]}`);
    } else {
      neverSetProps.push(prop);
      console.log(`[NEVER SET IN PROD] ${prop}`);
    }
  } catch {
    neverSetProps.push(prop);
    console.log(`[NEVER SET IN PROD] ${prop}`);
  }
}

console.log(`\nProperties set in production: ${productionSetProps.size}`);
console.log(`Properties NEVER set in production: ${neverSetProps.length}`);

console.log("\n=== SUMMARY OF NEVER-SET CONTEXT FIELDS ===");
console.log(neverSetProps.join(", "));
