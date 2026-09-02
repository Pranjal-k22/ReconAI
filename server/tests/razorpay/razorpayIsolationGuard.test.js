import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Razorpay Isolation Architecture Guard", () => {
  it("Razorpay adapter services MUST NOT import GroundTruth, syntheticFeePolicy, or matchingEngine", () => {
    const razorpayDir = path.resolve(__dirname, "../../src/services/razorpay");
    const files = fs.readdirSync(razorpayDir).filter((f) => f.endsWith(".js"));

    expect(files.length).toBeGreaterThan(0);

    const forbiddenTerms = [
      "GroundTruth",
      "syntheticFeePolicy",
      "matchingEngine",
      "reconcileScenario"
    ];

    for (const file of files) {
      const filePath = path.join(razorpayDir, file);
      const content = fs.readFileSync(filePath, "utf-8");

      for (const term of forbiddenTerms) {
        expect(
          content.includes(term),
          `Forbidden dependency '${term}' detected in ${file}`
        ).toBe(false);
      }
    }
  });
});
