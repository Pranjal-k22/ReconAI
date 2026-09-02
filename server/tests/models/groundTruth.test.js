import { describe, it, expect } from "vitest";
import { GroundTruth } from "../../src/models/GroundTruth.js";

describe("GroundTruth Model Schema & Validation", () => {
  it("should validate a valid ground truth benchmark record", async () => {
    const gt = new GroundTruth({
      datasetVersion: "benchmark-v1.0",
      merchantOrderId: "ORD-100001",
      expectedClassification: "MATCHED",
      expectedPaymentIds: ["pay_ABC123"],
      expectedSettlementRecordIds: ["set_rec_001"],
      expectedRequiresReview: false,
      notes: "Clean 3-way exact match benchmark scenario"
    });

    const err = await gt.validate();
    expect(err).toBeUndefined();
  });

  it("should reject missing datasetVersion, merchantOrderId, or expectedClassification", async () => {
    const gt = new GroundTruth({
      notes: "Incomplete"
    });

    await expect(gt.validate()).rejects.toThrow();
  });

  it("should reject invalid expectedClassification", async () => {
    const gt = new GroundTruth({
      datasetVersion: "benchmark-v1.0",
      merchantOrderId: "ORD-100002",
      expectedClassification: "INVALID_CLASSIFICATION_NAME"
    });

    await expect(gt.validate()).rejects.toThrow();
  });

  it("should verify unique compound index configuration for datasetVersion + merchantOrderId", () => {
    const indexes = GroundTruth.schema.indexes();
    const compoundUniqueIndex = indexes.find(
      ([indexObj, options]) =>
        indexObj.datasetVersion === 1 &&
        indexObj.merchantOrderId === 1 &&
        options?.unique === true
    );

    expect(compoundUniqueIndex).toBeDefined();
  });
});
