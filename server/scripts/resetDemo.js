import dotenv from "dotenv";
dotenv.config();

import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { BENCHMARK_CONSTANTS } from "../src/services/demo/benchmarkGenerator.js";
import { MerchantOrder } from "../src/models/MerchantOrder.js";
import { GatewayPayment } from "../src/models/GatewayPayment.js";
import { SettlementRecord } from "../src/models/SettlementRecord.js";
import { GroundTruth } from "../src/models/GroundTruth.js";

const resetDemoData = async () => {
  console.log("🧹 Resetting ReconAI Benchmark Data...");

  try {
    const connected = await connectDatabase();
    if (!connected) {
      console.error("❌ MONGODB_URI not provided or database connection failed.");
      process.exit(1);
    }

    const batchId = BENCHMARK_CONSTANTS.IMPORT_BATCH_ID;
    const datasetVersion = BENCHMARK_CONSTANTS.DATASET_VERSION;

    const resOrders = await MerchantOrder.deleteMany({ importBatchId: batchId });
    const resPayments = await GatewayPayment.deleteMany({ importBatchId: batchId });
    const resSettlements = await SettlementRecord.deleteMany({ importBatchId: batchId });
    const resGt = await GroundTruth.deleteMany({ datasetVersion });

    console.log("✅ Benchmark Data Reset Complete!");
    console.log(`   - Removed ${resOrders.deletedCount} merchant orders`);
    console.log(`   - Removed ${resPayments.deletedCount} gateway payments`);
    console.log(`   - Removed ${resSettlements.deletedCount} settlement records`);
    console.log(`   - Removed ${resGt.deletedCount} ground truth records`);

    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    console.error("❌ Benchmark Reset Failed:", error.message);
    await disconnectDatabase();
    process.exit(1);
  }
};

resetDemoData();
