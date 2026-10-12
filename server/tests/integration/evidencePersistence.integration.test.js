import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { EvidenceRecord } from "../../src/models/EvidenceRecord.js";
import {
  classifyPaymentScenario,
  persistEvidenceFinding
} from "../../src/services/classification/evidenceClassifier.js";

/**
 * Sanitizes MongoDB connection URIs to prevent credential leakage in test logs.
 */
function sanitizeMongoUri(uri) {
  if (!uri) return "";
  try {
    return uri.replace(/\/\/(.*):(.*)@/, "//***:***@");
  } catch {
    return "[REDACTED_URI]";
  }
}

/**
 * Validates the test database URI to guarantee complete isolation.
 */
function validateTestDatabaseUri(uri) {
  if (!uri || typeof uri !== "string") {
    throw new Error("MONGODB_TEST_URI must be provided as a non-empty string");
  }

  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    throw new Error("Invalid MONGODB_TEST_URI scheme: must start with mongodb:// or mongodb+srv://");
  }

  if (process.env.MONGODB_URI && uri.trim() === process.env.MONGODB_URI.trim()) {
    throw new Error(
      "Safety violation: MONGODB_TEST_URI matches development/app MONGODB_URI. Integration tests require an isolated test database."
    );
  }

  let dbName = "";
  try {
    const url = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, "http://"));
    dbName = url.pathname.replace(/^\//, "");
  } catch {
    const match = uri.match(/\/([^/?]+)(\?|$)/);
    if (match) dbName = match[1];
  }

  if (!dbName) {
    throw new Error("Safety violation: MONGODB_TEST_URI must explicitly specify a database name.");
  }

  const lowerName = dbName.toLowerCase();
  if (!lowerName.includes("test")) {
    throw new Error(
      `Safety violation: Test database name '${dbName}' must contain 'test' to guarantee isolation.`
    );
  }

  if (lowerName.includes("prod")) {
    throw new Error(
      `Safety violation: Test database name '${dbName}' contains 'prod'. Execution refused.`
    );
  }

  return uri;
}

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_evidence_persistence";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);
const SANITIZED_TEST_URI = sanitizeMongoUri(TEST_DB_URI);

describe("ReconAI 2.0 - Real MongoDB Evidence Persistence & Tenant Isolation Integration", { timeout: 35000 }, () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
    await EvidenceRecord.syncIndexes();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await EvidenceRecord.deleteMany({});
    }
  });

  it("1. Persists evidence finding durably and verifies across disconnect/reconnect", async () => {
    const tenantId = "sh_merchant_alpha";
    const finding = classifyPaymentScenario({
      gatewayPayment: {
        gatewayPaymentId: "pay_persist_01",
        status: "CAPTURED",
        amountPaise: 125000,
        currency: "INR",
        tenantId
      },
      merchantOrder: {
        merchantOrderId: "ORD-PERSIST-01",
        status: "CANCELLED",
        amountPaise: 125000,
        currency: "INR",
        tenantId
      }
    });

    const persisted = await persistEvidenceFinding(finding, {
      tenantId,
      merchantOrderId: "ORD-PERSIST-01",
      gatewayPaymentId: "pay_persist_01",
      evaluationKey: "alpha:ORD-PERSIST-01:eval_01"
    });

    expect(persisted._id).toBeDefined();
    expect(persisted.recordId).toMatch(/^EVID-/);
    expect(persisted.scenarioId).toBe("CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED");
    expect(persisted.category).toBe("CANCELLED_ORDER_CAPTURED");
    expect(persisted.safeHold).toBe(true);
    expect(persisted.safeHoldCode).toBe("LATE_CAPTURE_CANCELLED_ORDER");
    expect(persisted.facts.length).toBeGreaterThan(0);
    expect(persisted.supportingEvidence.length).toBeGreaterThan(0);

    // Disconnect and reconnect to verify machine persistence
    await mongoose.disconnect();
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });

    const retrieved = await EvidenceRecord.findOne({
      tenantId,
      recordId: persisted.recordId
    });

    expect(retrieved).not.toBeNull();
    expect(retrieved.scenarioId).toBe("CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED");
    expect(retrieved.recommendation).toBe("SAFE_HOLD_PRESERVE_CANCELLATION");
  });

  it("2. Deduplicates evaluations on unique compound key (tenantId + evaluationKey)", async () => {
    const tenantId = "sh_merchant_alpha";
    const evalKey = "sh_merchant_alpha:CASE-101:eval_key_unique";

    const finding = classifyPaymentScenario({
      gatewayPayment: {
        gatewayPaymentId: "pay_dedup_01",
        status: "CAPTURED",
        amountPaise: 50000,
        currency: "INR",
        tenantId
      },
      merchantOrder: {
        merchantOrderId: "ORD-DEDUP-01",
        status: "PENDING",
        amountPaise: 50000,
        currency: "INR",
        tenantId
      },
      context: { frontendTimeout: true }
    });

    // First persistence call
    const first = await persistEvidenceFinding(finding, {
      tenantId,
      evaluationKey: evalKey
    });

    // Second persistence call with identical key
    const second = await persistEvidenceFinding(finding, {
      tenantId,
      evaluationKey: evalKey
    });

    expect(first._id.toString()).toBe(second._id.toString());
    expect(first.recordId).toBe(second.recordId);

    const count = await EvidenceRecord.countDocuments({ tenantId, evaluationKey: evalKey });
    expect(count).toBe(1);
  });

  it("3. Enforces strict tenant isolation across queries", async () => {
    const findingAlpha = classifyPaymentScenario({
      gatewayPayment: {
        gatewayPaymentId: "pay_alpha_01",
        status: "CAPTURED",
        amountPaise: 50000,
        currency: "INR",
        tenantId: "tenant_alpha"
      },
      merchantOrder: {
        merchantOrderId: "ORD-ALPHA-01",
        status: "PENDING",
        amountPaise: 50000,
        currency: "INR",
        tenantId: "tenant_alpha"
      }
    });

    const findingBeta = classifyPaymentScenario({
      gatewayPayment: {
        gatewayPaymentId: "pay_beta_01",
        status: "CAPTURED",
        amountPaise: 50000,
        currency: "INR",
        tenantId: "tenant_beta"
      },
      merchantOrder: {
        merchantOrderId: "ORD-BETA-01",
        status: "PENDING",
        amountPaise: 50000,
        currency: "INR",
        tenantId: "tenant_beta"
      }
    });

    await persistEvidenceFinding(findingAlpha, {
      tenantId: "tenant_alpha",
      evaluationKey: "alpha:eval_1"
    });

    await persistEvidenceFinding(findingBeta, {
      tenantId: "tenant_beta",
      evaluationKey: "beta:eval_1"
    });

    // Query tenant alpha
    const alphaRecords = await EvidenceRecord.find({ tenantId: "tenant_alpha" });
    expect(alphaRecords.length).toBe(1);
    expect(alphaRecords[0].gatewayPaymentId).toBe("pay_alpha_01");

    // Query tenant beta
    const betaRecords = await EvidenceRecord.find({ tenantId: "tenant_beta" });
    expect(betaRecords.length).toBe(1);
    expect(betaRecords[0].gatewayPaymentId).toBe("pay_beta_01");
  });

  it("4. Automatically sanitizes metadata and strips sensitive customer PII", async () => {
    const tenantId = "sh_merchant_alpha";
    const finding = classifyPaymentScenario({
      context: {
        tenantId,
        customerName: "Alice Smith", // PII
        customerEmail: "alice@example.com", // PII
        cardNumber: "4111222233334444", // Sensitive
        cvv: "123", // Sensitive
        batchId: "BATCH-OK-99", // Safe
        retryCount: 2 // Safe
      }
    });

    const persisted = await persistEvidenceFinding(finding, {
      tenantId,
      evaluationKey: "alpha:pii_test"
    });

    const meta = persisted.redactedMetadata || {};
    expect(meta.customerName).toBeUndefined();
    expect(meta.customerEmail).toBeUndefined();
    expect(meta.cardNumber).toBeUndefined();
    expect(meta.cvv).toBeUndefined();
    expect(meta.batchId).toBe("BATCH-OK-99");
    expect(meta.retryCount).toBe(2);
  });
});
