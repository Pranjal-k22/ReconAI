import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, "../../src");

function getAllSourceFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllSourceFiles(fullPath));
    } else if (file.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("ITEM i — No More ADMIN_HOLD Writers", () => {
  it("proves that no writer in server/src emits, assigns, or writes ADMIN_HOLD", () => {
    const sourceFiles = getAllSourceFiles(srcDir);
    const violations = [];

    for (const file of sourceFiles) {
      const relPath = path.relative(srcDir, file).replace(/\\/g, "/");
      const content = fs.readFileSync(file, "utf8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        // Exclude the deprecated enum definition in PaymentCase.js
        if (relPath === "models/PaymentCase.js") {
          if (line.includes("// DEPRECATED") || line.includes('"ADMIN_HOLD",')) {
            return;
          }
        }

        if (line.includes("ADMIN_HOLD")) {
          violations.push({
            file: relPath,
            line: index + 1,
            text: line.trim()
          });
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
