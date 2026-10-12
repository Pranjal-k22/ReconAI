import mongoose from "mongoose";
import { logger } from "../src/config/logger.js";
import { validateEnv } from "../src/config/env.js";

/**
 * ReconAI 2.0 - PaymentLifecycleEvent Index Migration Utility
 *
 * Safely inspects and migrates MongoDB collection indexes without data loss.
 * Specifically updates `accountBodyHash_1` from legacy sparse unique or basic string
 * filter definitions to the non-empty string partial unique index:
 *   partialFilterExpression: { accountBodyHash: { $type: "string", $gt: "" } }
 *
 * Preconditions:
 * 1. MongoDB connection established.
 * 2. Does not delete, modify, or drop any document in paymentlifecycleevents.
 * 3. Does not drop any other index.
 * 4. Idempotent: safe to run multiple times without side effects.
 */
export async function migratePaymentLifecycleIndexes(db) {
  const collection = db.collection("paymentlifecycleevents");
  const indexes = await collection.indexes();
  const existingHashIndex = indexes.find((i) => i.name === "accountBodyHash_1");

  const desiredPartialFilter = { accountBodyHash: { $type: "string", $gt: "" } };

  if (existingHashIndex) {
    const isAlreadyDesired =
      existingHashIndex.unique === true &&
      existingHashIndex.partialFilterExpression &&
      existingHashIndex.partialFilterExpression.accountBodyHash &&
      existingHashIndex.partialFilterExpression.accountBodyHash.$type === "string" &&
      existingHashIndex.partialFilterExpression.accountBodyHash.$gt === "";

    if (isAlreadyDesired) {
      return {
        status: "NO_CHANGE_NEEDED",
        message: "Index accountBodyHash_1 is already up-to-date with non-empty partial unique filter."
      };
    }

    logger.info("Found legacy/conflicting accountBodyHash_1 index. Dropping old index definition...");
    await collection.dropIndex("accountBodyHash_1");
  }

  logger.info("Creating partial unique index accountBodyHash_1 with non-empty string filter...");
  await collection.createIndex(
    { accountBodyHash: 1 },
    {
      name: "accountBodyHash_1",
      unique: true,
      partialFilterExpression: desiredPartialFilter,
      background: true
    }
  );

  return {
    status: "MIGRATED",
    message: "Successfully upgraded accountBodyHash_1 to partial unique index with non-empty string filter."
  };
}

// Standalone execution entrypoint
if (process.argv[1] && process.argv[1].endsWith("migrateIndexes.js")) {
  const runMigration = async () => {
    try {
      const env = validateEnv();
      const mongoUri = process.env.MONGODB_URI || env.MONGODB_URI;

      if (!mongoUri) {
        logger.error("❌ MONGODB_URI is required to run index migration.");
        process.exit(1);
      }

      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      logger.info("Connected to MongoDB for index migration.");

      const result = await migratePaymentLifecycleIndexes(mongoose.connection.db);
      logger.info(`✅ Index migration finished: ${result.status} - ${result.message}`);

      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      logger.error(`❌ Index migration failed: ${err.message}`);
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      process.exit(1);
    }
  };

  runMigration();
}
