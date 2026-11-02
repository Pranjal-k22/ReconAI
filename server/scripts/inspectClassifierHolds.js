import mongoose from "mongoose";
import { PaymentCase } from "../src/models/PaymentCase.js";
import { GatewayPayment } from "../src/models/GatewayPayment.js";
import { MerchantOrder } from "../src/models/MerchantOrder.js";
import { EvidenceRecord } from "../src/models/EvidenceRecord.js";
import { classifyCase } from "../src/services/classification/classificationService.js";
import { seedWorkspaceDemo } from "./seedWorkspaceDemo.js";

const MONGO_URI = process.env.MONGODB_TEST_URI || "mongodb://127.0.0.1:27017/reconai_test_workspace_demo";
process.env.DEMO_SEED_PASSWORD = "DemoTestPassword123!";

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to Mongo.");

  await seedWorkspaceDemo();
  console.log("Seeded demo cases.");

  const cases = await PaymentCase.find({}).sort({ detectedAt: -1 }).lean();
  console.log(`\nFound ${cases.length} cases in DB:`);

  for (const c of cases) {
    console.log(`\n--- Case: ${c.caseId} (Tenant: ${c.tenantId}) ---`);
    console.log(`DB state: status=${c.resolutionCaseStatus}, isSafeHold=${c.isSafeHold}, safeHoldCode=${c.safeHoldCode || "none"}, category=${c.discrepancyCategory}`);

    try {
      const result = await classifyCase({
        tenantId: c.tenantId,
        caseId: c.caseId,
        actor: { id: "test-admin", role: "ADMIN" }
      });
      const finding = result.finding;
      console.log(`Classifier finding: scenarioId=${finding.scenarioId}, safeHold=${finding.safeHold}, safeHoldCode=${finding.safeHoldCode || "none"}, reasonCode=${finding.reasonCode}`);
    } catch (err) {
      console.log(`Classifier error: ${err.message}`);
    }
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
