import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("GroundTruth Isolation Architecture Guard", () => {
  it("verifies NO files in server/src/services/reconciliation/ import GroundTruth", () => {
    const reconcilationDir = path.resolve(__dirname, "../../src/services/reconciliation");
    const files = fs.readdirSync(reconcilationDir);

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
      const filePath = path.join(reconcilationDir, file);
      const content = fs.readFileSync(filePath, "utf-8");

      for (const term of forbiddenTerms) {
        const containsTerm = content.includes(term);
        expect(containsTerm, `File ${file} contains forbidden GroundTruth reference '${term}'`).toBe(false);
      }
    }
  });
});
