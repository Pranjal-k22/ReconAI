import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("GroundTruth Architecture Isolation Guard", () => {
  it("verifies NO files in server/src/services/reconciliation/ import GroundTruth", () => {
    const reconciliationDir = path.resolve(__dirname, "../../src/services/reconciliation");
    const files = fs.readdirSync(reconciliationDir);

    expect(files.length).toBeGreaterThan(0);

    const forbiddenTerms = [
      "GroundTruth",
      "models/GroundTruth",
      "expectedClassification",
      "expectedPaymentIds",
      "expectedSettlementRecordIds",
      "expectedRequiresReview"
    ];

    for (const file of files) {
      if (!file.endsWith(".js")) continue;
      const filePath = path.join(reconciliationDir, file);
      const content = fs.readFileSync(filePath, "utf-8");

      for (const term of forbiddenTerms) {
        const containsTerm = content.includes(term);
        expect(containsTerm, `File ${file} contains forbidden GroundTruth reference '${term}'`).toBe(false);
      }
    }
  });

  it("verifies GroundTruth is imported ONLY in evaluation service within server/src/services/", () => {
    const servicesDir = path.resolve(__dirname, "../../src/services");

    function scanDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".js")) {
          const relativePath = path.relative(servicesDir, fullPath).replace(/\\/g, "/");
          const content = fs.readFileSync(fullPath, "utf-8");

          if (content.includes("GroundTruth")) {
            // ONLY evaluation/ and demo/ (benchmark dataset generator) are allowed!
            expect(
              relativePath.startsWith("evaluation/") || relativePath.startsWith("demo/"),
              `File '${relativePath}' imports GroundTruth but is outside permitted evaluation/ or demo/ services`
            ).toBe(true);
          }
        }
      }
    }

    scanDir(servicesDir);
  });
});
