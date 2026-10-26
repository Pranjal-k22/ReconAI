import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../../src/app.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import { EvidenceRecord } from "../../src/models/EvidenceRecord.js";
import { PaymentLifecycleEvent } from "../../src/models/PaymentLifecycleEvent.js";
import { AiInvestigationRun } from "../../src/models/AiInvestigationRun.js";
import { PolicyDecision } from "../../src/models/PolicyDecision.js";
import { ProviderOperation } from "../../src/models/ProviderOperation.js";
import { signUserToken, ROLES } from "../../src/services/auth/tokenService.js";
import { validateTestDatabaseUri } from "../helpers/testDbGuard.js";

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_workspace_contract";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);

const TENANT = "tenant_contract_test_01";
const CASE_ID = "CASE-CONTRACT-001";
const PAYMENT_ID = "pay_contract_001";
const ORDER_ID = "order_contract_001";

describe("Workspace Read API Contract Invariant Tests (Real MongoDB)", { timeout: 35000 }, () => {
  let adminToken;
  let shopToken;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });

    adminToken = signUserToken({
      userId: "usr_admin_contract",
      role: ROLES.ADMIN,
      tenantId: null
    });

    shopToken = signUserToken({
      userId: "usr_shop_contract",
      role: ROLES.SHOP,
      tenantId: TENANT
    });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await Promise.all([
        PaymentCase.deleteMany({}),
        GatewayPayment.deleteMany({}),
        MerchantOrder.deleteMany({}),
        EvidenceRecord.deleteMany({}),
        PaymentLifecycleEvent.deleteMany({}),
        AiInvestigationRun.deleteMany({}),
        PolicyDecision.deleteMany({}),
        ProviderOperation.deleteMany({})
      ]);

      // Seed authoritative test entities
      await PaymentCase.create({
        caseId: CASE_ID,
        tenantId: TENANT,
        gatewayPaymentId: PAYMENT_ID,
        merchantOrderId: ORDER_ID,
        orderStatus: "ORDER_CREATED",
        captureStatus: "CAPTURE_CAPTURED",
        authorizationStatus: "AUTH_AUTHORIZED",
        refundStatus: "REFUND_NONE",
        disputeStatus: "DISPUTE_NONE",
        settlementStatus: "SETTLEMENT_NONE",
        customerDebitStatus: "DEBIT_VERIFIED",
        resolutionCaseStatus: "CASE_DETECTED",
        discrepancyCategory: "STATUS_MISMATCH",
        isSafeHold: true,
        safeHoldReason: "Payment captured on cancelled order",
        detectedAt: new Date(),
        updatedAt: new Date()
      });

      await GatewayPayment.create({
        gatewayPaymentId: PAYMENT_ID,
        tenantId: TENANT,
        amountPaise: 10000,
        currency: "INR",
        status: "CAPTURED",
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await MerchantOrder.create({
        merchantOrderId: ORDER_ID,
        tenantId: TENANT,
        amountPaise: 10000,
        currency: "INR",
        status: "CANCELLED",
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await EvidenceRecord.create({
        recordId: "EVID-CONTRACT-001",
        tenantId: TENANT,
        caseId: CASE_ID,
        merchantOrderId: ORDER_ID,
        gatewayPaymentId: PAYMENT_ID,
        scenarioId: "CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED",
        category: "CANCELLED_ORDER_CAPTURED",
        reasonCode: "PAYMENT_CAPTURED_ORDER_CANCELLED",
        ruleId: "R_CASE_22_LATE_CAPTURE_CANCELLED_ORDER",
        confidence: 1.0,
        explanation: "Payment captured after order was cancelled",
        recommendation: "Hold for operator review",
        facts: [
          {
            dimension: "gatewayPayment.status",
            value: "CAPTURED",
            source: "GATEWAY_WEBHOOK",
            authority: "PROVIDER_VERIFIED",
            verifiedAt: new Date()
          }
        ],
        claims: [
          {
            claimType: "CUSTOMER_CLAIM",
            statement: "Money debited from account",
            source: "CUSTOMER_PORTAL",
            authority: "CUSTOMER_CLAIM",
            verified: false
          }
        ],
        missingEvidence: [],
        contradictions: [],
        safeHold: true,
        safeHoldCode: "LATE_CAPTURE_CANCELLED_ORDER",
        safeHoldReason: "late capture on a cancelled order: held, no automatic refund or reopen",
        suggestedNextStep: "ADVISORY_HOLD_FOR_MANUAL_REVIEW",
        evaluationKey: `${CASE_ID}:hash_contract_01`,
        inputHash: "hash_contract_01",
        recordHash: "rec_hash_contract_01",
        evaluatedAt: new Date()
      });

      await PaymentLifecycleEvent.create({
        eventId: "evt_contract_001",
        tenantId: TENANT,
        caseId: CASE_ID,
        gatewayPaymentId: PAYMENT_ID,
        merchantOrderId: ORDER_ID,
        sourceSystem: "GATEWAY_WEBHOOK",
        normalizedEventType: "PAYMENT_CAPTURED",
        payloadFingerprint: "fp_contract_01",
        deduplicationKey: "dedup_contract_01",
        amountPaise: 10000,
        currency: "INR",
        providerOccurredAt: new Date(),
        ingestedAt: new Date()
      });

      await AiInvestigationRun.create({
        investigationId: "inv_contract_001",
        caseId: CASE_ID,
        tenantId: TENANT,
        idempotencyKey: "idem_inv_contract_01",
        status: "COMPLETED",
        modelUsed: "FALLBACK_DETERMINISTIC",
        customerPerspective: {
          perspective: "Customer reported issue",
          unverifiedClaims: ["Money debited"],
          confidence: 0.8
        },
        shopPerspective: {
          perspective: "Order marked cancelled before payment",
          confidence: 0.95
        },
        investigatorFindings: {
          perspective: "Late capture observed after order cancellation",
          contradictions: ["Order cancelled but payment captured"],
          confidence: 0.99
        },
        resolutionProposal: {
          suggestedAction: "SAFE_HOLD_FOR_HUMAN_OPERATOR",
          reasons: ["Late capture on cancelled order"]
        },
        evidenceCards: [
          { title: "Gateway Webhook", detail: "Capture received" }
        ],
        durationMs: 45,
        isExecutable: false,
        authoritative: false
      });

      await PolicyDecision.create({
        decisionId: "dec_contract_001",
        tenantId: TENANT,
        caseId: CASE_ID,
        idempotencyKey: "idem_dec_contract_01",
        inputHash: "hash_contract_01",
        proposedActionType: "REQUEST_REFUND",
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds: ["R_LATE_CAPTURE_CANCELLED_ORDER_HOLD"],
        decisionReasons: ["Late capture on cancelled order triggers mandatory hold"],
        allowReasons: [],
        denyReasons: ["Cancelled order requires manual human review"],
        missingEvidence: [],
        amountPaise: 10000,
        currency: "INR",
        policyVersion: "2026-10-12.v1",
        policyConfigVersion: 1,
        policyConfigHash: "hash_config_01",
        classificationRecordId: "EVID-CONTRACT-001",
        classificationInputHash: "hash_contract_01"
      });

      await ProviderOperation.create({
        operationId: "op_contract_001",
        tenantId: TENANT,
        caseId: CASE_ID,
        gatewayPaymentId: PAYMENT_ID,
        operationType: "REFUND",
        provider: "RAZORPAY",
        operationStatus: "REQUESTED",
        amountPaise: 10000,
        currency: "INR",
        idempotencyKey: "idem_op_contract_01"
      });
    }
  });

  it("Contract 1: GET /api/payment-cases returns expected response keys", async () => {
    const res = await request(app)
      .get("/api/payment-cases")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("cases");
    expect(res.body.data).toHaveProperty("pagination");
    expect(res.body.data.pagination).toHaveProperty("page");
    expect(res.body.data.pagination).toHaveProperty("limit");
    expect(res.body.data.pagination).toHaveProperty("total");
    expect(res.body.data.pagination).toHaveProperty("pages");

    const item = res.body.data.cases[0];
    expect(item).toHaveProperty("caseId");
    expect(item).toHaveProperty("tenantId");
    expect(item).toHaveProperty("gatewayPaymentId");
    expect(item).toHaveProperty("merchantOrderId");
    expect(item).toHaveProperty("resolutionCaseStatus");
    expect(item).toHaveProperty("isSafeHold");
    expect(item).toHaveProperty("safeHoldReason");
    expect(item).toHaveProperty("detectedAt");
    expect(item).toHaveProperty("updatedAt");
  });

  it("Contract 2: GET /api/payment-cases/:caseId returns 8-dimension state grid keys", async () => {
    const res = await request(app)
      .get(`/api/payment-cases/${CASE_ID}`)
      .set("Authorization", `Bearer ${shopToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data).toHaveProperty("caseId", CASE_ID);
    expect(data).toHaveProperty("tenantId", TENANT);
    expect(data).toHaveProperty("gatewayPaymentId", PAYMENT_ID);
    expect(data).toHaveProperty("merchantOrderId", ORDER_ID);
    expect(data).toHaveProperty("orderStatus");
    expect(data).toHaveProperty("captureStatus");
    expect(data).toHaveProperty("authorizationStatus");
    expect(data).toHaveProperty("refundStatus");
    expect(data).toHaveProperty("disputeStatus");
    expect(data).toHaveProperty("customerDebitStatus");
    expect(data).toHaveProperty("resolutionCaseStatus");
    expect(data).toHaveProperty("discrepancyCategory");
    expect(data).toHaveProperty("isSafeHold");
    expect(data).toHaveProperty("safeHoldReason");
  });

  it("Contract 3: GET /api/payment-cases/:caseId/classification returns EvidenceRecord fields", async () => {
    const res = await request(app)
      .get(`/api/payment-cases/${CASE_ID}/classification`)
      .set("Authorization", `Bearer ${shopToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data).toHaveProperty("recordId");
    expect(data).toHaveProperty("scenarioId");
    expect(data).toHaveProperty("category");
    expect(data).toHaveProperty("reasonCode");
    expect(data).toHaveProperty("confidence");
    expect(data).toHaveProperty("facts");
    expect(data).toHaveProperty("claims");
    expect(data).toHaveProperty("missingEvidence");
    expect(data).toHaveProperty("contradictions");
    expect(data).toHaveProperty("safeHold");
    expect(data).toHaveProperty("safeHoldCode");
    expect(data).toHaveProperty("safeHoldReason");
    expect(data).toHaveProperty("suggestedNextStep");
    expect(data).toHaveProperty("inputHash");
    expect(data).toHaveProperty("recordHash");
    expect(data).toHaveProperty("evaluatedAt");
  });

  it("Contract 4: GET /api/payment-events/case/:caseId returns lifecycle timeline fields", async () => {
    const res = await request(app)
      .get(`/api/payment-events/case/${CASE_ID}`)
      .set("Authorization", `Bearer ${shopToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const evt = res.body.data[0];
    expect(evt).toHaveProperty("eventId");
    expect(evt).toHaveProperty("tenantId", TENANT);
    expect(evt).toHaveProperty("caseId", CASE_ID);
    expect(evt).toHaveProperty("sourceSystem");
    expect(evt).toHaveProperty("normalizedEventType");
    expect(evt).toHaveProperty("amountPaise");
    expect(evt).toHaveProperty("currency");
    expect(evt).toHaveProperty("ingestedAt");
  });

  it("Contract 5: GET /api/payment-cases/:caseId/investigations returns agent cards keys", async () => {
    const res = await request(app)
      .get(`/api/payment-cases/${CASE_ID}/investigations`)
      .set("Authorization", `Bearer ${shopToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const inv = res.body.data[0];
    expect(inv).toHaveProperty("investigationId");
    expect(inv).toHaveProperty("caseId", CASE_ID);
    expect(inv).toHaveProperty("status");
    expect(inv).toHaveProperty("modelUsed");
    expect(inv).toHaveProperty("customerPerspective");
    expect(inv).toHaveProperty("shopPerspective");
    expect(inv).toHaveProperty("investigatorFindings");
    expect(inv).toHaveProperty("resolutionProposal");
    expect(inv).toHaveProperty("evidenceCards");
    expect(inv).toHaveProperty("durationMs");
    expect(inv).toHaveProperty("isExecutable", false);
    expect(inv).toHaveProperty("authoritative", false);
    expect(inv).toHaveProperty("createdAt");
  });

  it("Contract 6: GET /api/payment-cases/:caseId/policy/decisions returns policy keys with configVersion", async () => {
    const res = await request(app)
      .get(`/api/payment-cases/${CASE_ID}/policy/decisions`)
      .set("Authorization", `Bearer ${shopToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const dec = res.body.data[0];
    expect(dec).toHaveProperty("decisionId");
    expect(dec).toHaveProperty("proposedActionType");
    expect(dec).toHaveProperty("outcomeStatus");
    expect(dec).toHaveProperty("appliedRuleIds");
    expect(dec).toHaveProperty("decisionReasons");
    expect(dec).toHaveProperty("amountPaise");
    expect(dec).toHaveProperty("currency");
    expect(dec).toHaveProperty("policyVersion");
    expect(dec).toHaveProperty("policyConfigVersion");
    expect(dec).toHaveProperty("classificationRecordId");
    expect(dec).toHaveProperty("classificationInputHash");
    expect(dec).toHaveProperty("createdAt");
  });

  it("Contract 7: GET /api/payment-cases/:caseId/provider/operations returns operation fields", async () => {
    const res = await request(app)
      .get(`/api/payment-cases/${CASE_ID}/provider/operations`)
      .set("Authorization", `Bearer ${shopToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const op = res.body.data[0];
    expect(op).toHaveProperty("operationId");
    expect(op).toHaveProperty("gatewayPaymentId");
    expect(op).toHaveProperty("operationType");
    expect(op).toHaveProperty("provider");
    expect(op).toHaveProperty("operationStatus");
    expect(op).toHaveProperty("amountPaise");
    expect(op).toHaveProperty("currency");
    expect(op).toHaveProperty("idempotencyKey");
    expect(op).toHaveProperty("createdAt");
  });
});
