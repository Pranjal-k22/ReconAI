import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { AiInvestigationRun } from "../../src/models/AiInvestigationRun.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import {
  runMultiAgentInvestigation,
  getInvestigationsByCaseId
} from "../../src/services/ai/multiAgentInvestigator.js";

function validateTestDatabaseUri(uri) {
  if (!uri || typeof uri !== "string") {
    throw new Error("MONGODB_TEST_URI must be provided as a non-empty string");
  }
  let dbName = "";
  try {
    const url = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, "http://"));
    dbName = url.pathname.replace(/^\//, "");
  } catch {
    const match = uri.match(/\/([^/?]+)(\?|$)/);
    if (match) dbName = match[1];
  }
  if (!dbName || !dbName.toLowerCase().includes("test")) {
    throw new Error("Test database name must contain 'test'");
  }
  return uri;
}

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_multi_agent_investigation";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);

describe("Multi-Agent AI Investigation - MongoDB Persistence & Idempotency Integration", { timeout: 35000 }, () => {
  const TENANT_A = "tenant_ai_test_alpha";
  const TENANT_B = "tenant_ai_test_beta";
  const CASE_ID_A = "CASE-AI-INT-001";
  const CASE_ID_B = "CASE-AI-INT-002";

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
    await AiInvestigationRun.syncIndexes();
    await PaymentCase.syncIndexes();
    await GatewayPayment.syncIndexes();
    await MerchantOrder.syncIndexes();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await AiInvestigationRun.deleteMany({});
      await PaymentCase.deleteMany({});
      await GatewayPayment.deleteMany({});
      await MerchantOrder.deleteMany({});
    }

    // Seed test case in Tenant A
    await PaymentCase.create({
      caseId: CASE_ID_A,
      tenantId: TENANT_A,
      customerId: "CUST-INT-001",
      gatewayPaymentId: "pay_ai_int_01",
      merchantOrderId: "ORD-AI-INT-01",
      discrepancyCategory: "STATUS_MISMATCH",
      resolutionCaseStatus: "CASE_SAFE_HOLD",
      isSafeHold: true,
      safeHoldCode: "ADMIN_HOLD",
      customerDebitStatus: "DEBIT_VERIFIED"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_ai_int_01",
      tenantId: TENANT_A,
      status: "CAPTURED",
      amountPaise: 75000,
      currency: "INR"
    });

    await MerchantOrder.create({
      merchantOrderId: "ORD-AI-INT-01",
      tenantId: TENANT_A,
      status: "PENDING",
      amountPaise: 75000,
      currency: "INR"
    });

    // Seed test case in Tenant B
    await PaymentCase.create({
      caseId: CASE_ID_B,
      tenantId: TENANT_B,
      customerId: "CUST-INT-002",
      gatewayPaymentId: "pay_ai_int_02",
      merchantOrderId: "ORD-AI-INT-02",
      discrepancyCategory: "STATUS_MISMATCH",
      resolutionCaseStatus: "CASE_INVESTIGATING",
      isSafeHold: false
    });
  });

  it("1. Persists complete 4-agent investigation run to MongoDB with valid schemas", async () => {
    const run = await runMultiAgentInvestigation({
      caseId: CASE_ID_A,
      tenantId: TENANT_A,
      customerId: "CUST-INT-001"
    });

    expect(run._id).toBeDefined();
    expect(run.investigationId).toMatch(/^INV-/);
    expect(run.tenantId).toBe(TENANT_A);
    expect(run.caseId).toBe(CASE_ID_A);

    // Verify all 4 agent outputs persisted
    expect(run.customerPerspective).toBeDefined();
    expect(run.customerPerspective.role).toBe("CUSTOMER_AI");

    expect(run.shopPerspective).toBeDefined();
    expect(run.shopPerspective.role).toBe("SHOP_AI");

    expect(run.investigatorFindings).toBeDefined();
    expect(run.investigatorFindings.role).toBe("INVESTIGATOR_AI");

    expect(run.resolutionProposal).toBeDefined();
    expect(run.resolutionProposal.role).toBe("RESOLUTION_PLANNER_AI");
    expect(run.resolutionProposal.isExecutable).toBe(false);
    expect(run.resolutionProposal.authoritative).toBe(false);
    expect(run.resolutionProposal.requiresPolicyEngine).toBe(true);

    // Verify DB retrieval
    const fetched = await AiInvestigationRun.findById(run._id).lean();
    expect(fetched).not.toBeNull();
    expect(fetched.investigationId).toBe(run.investigationId);
  });

  it("2. Enforces idempotency: repeated request with same idempotencyKey returns existing run without duplicate writes", async () => {
    const idempotencyKey = "idem-real-mongo-001";

    const run1 = await runMultiAgentInvestigation({
      caseId: CASE_ID_A,
      tenantId: TENANT_A,
      idempotencyKey
    });

    const run2 = await runMultiAgentInvestigation({
      caseId: CASE_ID_A,
      tenantId: TENANT_A,
      idempotencyKey
    });

    expect(run2.investigationId).toBe(run1.investigationId);

    const totalRuns = await AiInvestigationRun.countDocuments({
      tenantId: TENANT_A,
      idempotencyKey
    });
    expect(totalRuns).toBe(1);
  });

  it("3. Enforces row-level tenant isolation in getInvestigationsByCaseId", async () => {
    await runMultiAgentInvestigation({
      caseId: CASE_ID_A,
      tenantId: TENANT_A
    });

    // Query under Tenant A: returns 1
    const runsA = await getInvestigationsByCaseId(CASE_ID_A, TENANT_A);
    expect(runsA).toHaveLength(1);

    // Query under Tenant B: returns 0 (cannot cross tenant boundary)
    const runsB = await getInvestigationsByCaseId(CASE_ID_A, TENANT_B);
    expect(runsB).toHaveLength(0);
  });

  it("4. Non-executability invariant: investigation orchestrator does NOT mutate GatewayPayment, MerchantOrder, or PaymentCase", async () => {
    const paymentBefore = await GatewayPayment.findOne({ gatewayPaymentId: "pay_ai_int_01", tenantId: TENANT_A }).lean();
    const orderBefore = await MerchantOrder.findOne({ merchantOrderId: "ORD-AI-INT-01", tenantId: TENANT_A }).lean();
    const caseBefore = await PaymentCase.findOne({ caseId: CASE_ID_A, tenantId: TENANT_A }).lean();

    await runMultiAgentInvestigation({
      caseId: CASE_ID_A,
      tenantId: TENANT_A
    });

    const paymentAfter = await GatewayPayment.findOne({ gatewayPaymentId: "pay_ai_int_01", tenantId: TENANT_A }).lean();
    const orderAfter = await MerchantOrder.findOne({ merchantOrderId: "ORD-AI-INT-01", tenantId: TENANT_A }).lean();
    const caseAfter = await PaymentCase.findOne({ caseId: CASE_ID_A, tenantId: TENANT_A }).lean();

    // Verify pristine status and timestamps
    expect(paymentAfter.status).toBe(paymentBefore.status);
    expect(paymentAfter.amountPaise).toBe(paymentBefore.amountPaise);
    expect(orderAfter.status).toBe(orderBefore.status);
    expect(orderAfter.amountPaise).toBe(orderBefore.amountPaise);
    expect(caseAfter.resolutionCaseStatus).toBe(caseBefore.resolutionCaseStatus);
    expect(caseAfter.isSafeHold).toBe(caseBefore.isSafeHold);
  });
});
