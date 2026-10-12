import mongoose from "mongoose";
import { logger } from "../src/config/logger.js";
import { validateEnv } from "../src/config/env.js";

/**
 * ReconAI 2.0 - Gapless Replay-Index Migration Utility
 *
 * Implements an additive, zero-downtime index migration sequence:
 * 1. Precondition: Validates database target and scans for duplicate non-empty hashes.
 *    If duplicates exist, aborts and fails closed without modifying history.
 * 2. Additive Creation: Creates the replacement index `accountBodyHash_partial_unique_v2`
 *    with `{ partialFilterExpression: { accountBodyHash: { $type: "string", $gt: "" } } }`
 *    while any legacy index (`accountBodyHash_1`) remains active.
 * 3. Verification: Confirms that MongoDB has successfully activated the new index.
 * 4. Safe Retirement: Only after the replacement index is verified active, drops obsolete
 *    legacy index(es).
 * 5. Idempotent: Repeated execution detects that `accountBodyHash_partial_unique_v2` is active
 *    and no legacy index remains, returning NO_CHANGE_NEEDED.
 */

export const REPLACEMENT_INDEX_NAME = "accountBodyHash_partial_unique_v2";
export const LEGACY_INDEX_NAMES = ["accountBodyHash_1"];

export async function migratePaymentLifecycleIndexes(db) {
  const collection = db.collection("paymentlifecycleevents");
  const indexes = await collection.indexes();
  const replacementIdx = indexes.find((i) => i.name === REPLACEMENT_INDEX_NAME);
  const legacyIndices = indexes.filter((i) => LEGACY_INDEX_NAMES.includes(i.name));

  const desiredPartialFilter = { accountBodyHash: { $type: "string", $gt: "" } };

  // Step 1: Idempotency check - already migrated if replacement exists with correct specs and no legacy index remains
  const isReplacementValid =
    replacementIdx &&
    replacementIdx.unique === true &&
    replacementIdx.partialFilterExpression &&
    replacementIdx.partialFilterExpression.accountBodyHash &&
    replacementIdx.partialFilterExpression.accountBodyHash.$type === "string" &&
    replacementIdx.partialFilterExpression.accountBodyHash.$gt === "";

  if (isReplacementValid && legacyIndices.length === 0) {
    return {
      status: "NO_CHANGE_NEEDED",
      replacementIndex: REPLACEMENT_INDEX_NAME,
      message: `Index ${REPLACEMENT_INDEX_NAME} is active and no obsolete legacy index found.`
    };
  }

  // Step 2: Precondition check - verify no duplicate valid non-empty hashes exist before creating unique index
  if (!isReplacementValid) {
    const duplicates = await collection
      .aggregate([
        {
          $match: {
            accountBodyHash: { $type: "string", $gt: "" }
          }
        },
        {
          $group: {
            _id: "$accountBodyHash",
            count: { $sum: 1 },
            eventIds: { $push: "$eventId" }
          }
        },
        {
          $match: {
            count: { $gt: 1 }
          }
        }
      ])
      .toArray();

    if (duplicates.length > 0) {
      const err = new Error(
        `Precondition failed: Found ${duplicates.length} duplicate non-empty accountBodyHash value(s) in collection. ` +
          `Migration aborted to prevent unique index build failure. Duplicates: ${JSON.stringify(duplicates)}`
      );
      err.code = "DUPLICATE_HASHES_FOUND";
      err.duplicates = duplicates;
      throw err;
    }

    // Step 3: Additive creation - create replacement index under new explicit name while legacy index remains active
    logger.info(
      `[GAPLESS MIGRATION] Creating replacement partial unique index '${REPLACEMENT_INDEX_NAME}' (legacy indexes remain active)...`
    );
    await collection.createIndex(
      { accountBodyHash: 1 },
      {
        name: REPLACEMENT_INDEX_NAME,
        unique: true,
        partialFilterExpression: desiredPartialFilter,
        background: true
      }
    );

    // Step 4: Verification - verify the replacement index definition in MongoDB metadata
    const postCreateIndexes = await collection.indexes();
    const verifiedNewIdx = postCreateIndexes.find((i) => i.name === REPLACEMENT_INDEX_NAME);
    if (!verifiedNewIdx || verifiedNewIdx.unique !== true) {
      throw new Error(
        `Verification failed: '${REPLACEMENT_INDEX_NAME}' was not verified as an active unique index in MongoDB.`
      );
    }
    logger.info(
      `[GAPLESS MIGRATION] Replacement index '${REPLACEMENT_INDEX_NAME}' verified active in MongoDB.`
    );
  }

  // Step 5: Safe retirement - drop obsolete legacy indexes only now that replacement index is active
  const retired = [];
  for (const legacy of legacyIndices) {
    logger.info(`[GAPLESS MIGRATION] Retiring obsolete legacy index '${legacy.name}'...`);
    await collection.dropIndex(legacy.name);
    retired.push(legacy.name);
  }

  return {
    status: "MIGRATED",
    replacementIndex: REPLACEMENT_INDEX_NAME,
    retiredIndices: retired,
    message: `Successfully established gapless replacement index ${REPLACEMENT_INDEX_NAME} and retired legacy index(es).`
  };
}

// Standalone execution entrypoint
if (process.argv[1] && process.argv[1].endsWith("migrateIndexes.js")) {
  const sanitizeUri = (uri) => {
    if (!uri) return "";
    try {
      return uri.replace(/\/\/(.*):(.*)@/, "//***:***@");
    } catch {
      return "[REDACTED_URI]";
    }
  };

  const runMigration = async () => {
    try {
      const env = validateEnv();
      const mongoUri = process.env.MONGODB_URI || env.MONGODB_URI;

      if (!mongoUri) {
        logger.error("❌ MONGODB_URI is required to run index migration.");
        process.exit(1);
      }

      logger.info(`Connecting to MongoDB for index migration at ${sanitizeUri(mongoUri)}...`);
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });

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
