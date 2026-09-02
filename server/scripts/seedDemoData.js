import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { generateBenchmarkData, BENCHMARK_CONSTANTS } from "../src/services/demo/benchmarkGenerator.js";
import { MerchantOrder } from "../src/models/MerchantOrder.js";
import { GatewayPayment } from "../src/models/GatewayPayment.js";
import { SettlementRecord } from "../src/models/SettlementRecord.js";
import { GroundTruth } from "../src/models/GroundTruth.js";

const seedDemoData = async () => {
  console.log("🌱 Starting ReconAI Benchmark Database Seeding...");

  try {
    const connected = await connectDatabase();
    if (!connected) {
      console.error("❌ MONGODB_URI not provided or database connection failed.");
      process.exit(1);
    }

    const data = generateBenchmarkData();
    const batchId = BENCHMARK_CONSTANTS.IMPORT_BATCH_ID;
    const datasetVersion = BENCHMARK_CONSTANTS.DATASET_VERSION;

    // 1. Safe Dataset-Scoped Cleanup (Idempotency)
    console.log(`🧹 Cleaning up previous benchmark records (batch: ${batchId})...`);
    await MerchantOrder.deleteMany({ importBatchId: batchId });
    await GatewayPayment.deleteMany({ importBatchId: batchId });
    await SettlementRecord.deleteMany({ importBatchId: batchId });
    await GroundTruth.deleteMany({ datasetVersion });

    // 2. Insert Records
    console.log("📥 Inserting Merchant Orders...");
    await MerchantOrder.insertMany(data.merchantOrders);

    console.log("📥 Inserting Gateway Payments...");
    await GatewayPayment.insertMany(data.gatewayPayments);

    console.log("📥 Inserting Settlement Records...");
    await SettlementRecord.insertMany(data.settlementRecords);

    console.log("📥 Inserting Ground Truth Records...");
    await GroundTruth.insertMany(data.groundTruth);

    // 3. Verify Database Counts
    const orderCount = await MerchantOrder.countDocuments({ importBatchId: batchId });
    const paymentCount = await GatewayPayment.countDocuments({ importBatchId: batchId });
    const settlementCount = await SettlementRecord.countDocuments({ importBatchId: batchId });
    const gtCount = await GroundTruth.countDocuments({ datasetVersion });

    console.log("✅ Benchmark Database Seeding Completed Successfully!");
    console.log("📊 Database Counts Verified:");
    console.log(`   - Merchant Orders: ${orderCount} (expected: ${data.merchantOrders.length})`);
    console.log(`   - Gateway Payments: ${paymentCount} (expected: ${data.gatewayPayments.length})`);
    console.log(`   - Settlement Records: ${settlementCount} (expected: ${data.settlementRecords.length})`);
    console.log(`   - Ground Truth Records: ${gtCount} (expected: ${data.groundTruth.length})`);

    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    console.error("❌ Benchmark Seeding Failed:", error.message);
    await disconnectDatabase();
    process.exit(1);
  }
};

seedDemoData();
