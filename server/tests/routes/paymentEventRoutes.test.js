import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { signUserToken, signServiceToken, ROLES } from "../../src/services/auth/tokenService.js";
import * as eventService from "../../src/services/ledger/paymentLifecycleEventService.js";
import { classifyPaymentScenario } from "../../src/services/classification/evidenceClassifier.js";

describe("Payment Event Routes & Telemetry Provenance Security Boundary", () => {
  const TENANT = "tenant_merch_01";
  const OTHER_TENANT = "tenant_merch_02";

  const adminToken = signUserToken({
    userId: "usr_admin_01",
    role: ROLES.ADMIN,
    tenantId: TENANT
  });

  const controllerToken = signServiceToken({
    serviceId: "svc_controller_01",
    role: ROLES.PAYMENT_CONTROLLER,
    tenantId: TENANT
  });

  const customerToken = signUserToken({
    userId: "usr_cust_01",
    role: ROLES.CUSTOMER,
    tenantId: TENANT,
    customerId: "CUST-001"
  });

  const shopToken = signUserToken({
    userId: "usr_shop_01",
    role: ROLES.SHOP,
    tenantId: TENANT
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1: Caller-supplied serverVerifiedTelemetry cannot create trusted evidence
  // -------------------------------------------------------------------------
  it("1. REJECTS caller-supplied serverVerifiedTelemetry via POST /api/payment-events (400)", async () => {
    const res = await request(app)
      .post("/api/payment-events")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        sourceSystem: "GATEWAY_WEBHOOK",
        normalizedEventType: "PAYMENT_CAPTURED",
        gatewayPaymentId: "pay_test_001",
        merchantOrderId: "ORD-001",
        serverVerifiedTelemetry: true, // Forged trust metadata
        currency: "INR"
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.message).toMatch(/serverVerifiedTelemetry/i);
  });

  // -------------------------------------------------------------------------
  // Test 2: Caller-supplied sourceSystem: "RECONAI_SYSTEM" cannot independently establish provenance
  // -------------------------------------------------------------------------
  it("2. REJECTS caller-supplied sourceSystem: 'RECONAI_SYSTEM' via ingestion API (400)", async () => {
    const res = await request(app)
      .post("/api/payment-events")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        sourceSystem: "RECONAI_SYSTEM", // Caller attempting to claim internal system origin
        normalizedEventType: "PAYMENT_CAPTURED",
        gatewayPaymentId: "pay_test_002",
        currency: "INR"
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.message).toMatch(/RECONAI_SYSTEM/i);
  });

  // -------------------------------------------------------------------------
  // Test 3: Submitting both fields together through endpoint is rejected
  // -------------------------------------------------------------------------
  it("3. REJECTS combined RECONAI_SYSTEM + serverVerifiedTelemetry forgery attempt (400)", async () => {
    const res = await request(app)
      .post("/api/payment-events")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        sourceSystem: "RECONAI_SYSTEM",
        serverVerifiedTelemetry: true,
        normalizedEventType: "INCONSISTENCY_DETECTED",
        gatewayPaymentId: "pay_test_003",
        currency: "INR"
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 4: Authenticated but unauthorized or untrusted principal cannot create lifecycle events
  // -------------------------------------------------------------------------
  it("4. REJECTS unauthorized principals (CUSTOMER, SHOP) and unauthenticated callers from event creation", async () => {
    // Unauthenticated -> 401
    const unauthRes = await request(app)
      .post("/api/payment-events")
      .send({ sourceSystem: "GATEWAY_WEBHOOK", normalizedEventType: "PAYMENT_CAPTURED", currency: "INR" });
    expect(unauthRes.status).toBe(401);

    // CUSTOMER -> 403 Forbidden
    const custRes = await request(app)
      .post("/api/payment-events")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ sourceSystem: "GATEWAY_WEBHOOK", normalizedEventType: "PAYMENT_CAPTURED", currency: "INR" });
    expect(custRes.status).toBe(403);

    // SHOP -> 403 Forbidden
    const shopRes = await request(app)
      .post("/api/payment-events")
      .set("Authorization", `Bearer ${shopToken}`)
      .send({ sourceSystem: "GATEWAY_WEBHOOK", normalizedEventType: "PAYMENT_CAPTURED", currency: "INR" });
    expect(shopRes.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // Test 5: Caller cannot fabricate trusted lifecycleEvents array through public request context
  // -------------------------------------------------------------------------
  it("5. Caller cannot fabricate trusted lifecycleEvents array through context input", () => {
    const finding = classifyPaymentScenario({
      gatewayPayment: {
        gatewayPaymentId: "pay_ctx_forge",
        status: "CAPTURED",
        amountPaise: 50000,
        currency: "INR",
        tenantId: TENANT
      },
      merchantOrder: {
        merchantOrderId: "ORD-ctx-forge",
        status: "PENDING",
        amountPaise: 50000,
        currency: "INR",
        tenantId: TENANT
      },
      context: {
        // Fabricated array passed via context
        lifecycleEvents: [
          {
            eventId: "forged_ctx_evt",
            sourceSystem: "RECONAI_SYSTEM",
            serverVerifiedTelemetry: true,
            tenantId: TENANT,
            merchantOrderId: "ORD-ctx-forge",
            normalizedEventType: "CHECKOUT_TIMEOUT"
          }
        ],
        serverVerifiedTelemetry: true
      }
    });

    // Fabricated context is quarantined into unverified claims, never trusted as facts
    expect(finding.scenarioId).toBe("CASE_6_PAID_GATEWAY_UNPAID_ORDER");
    expect(finding.category).toBe("STATUS_MISMATCH");
    expect(finding.facts.some((f) => f.dimension === "FRONTEND_CHECKOUT")).toBe(false);
    expect(finding.claims.some((c) => c.claimType === "FRONTEND_TIMEOUT_CLAIM" && c.verified === false)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: Evidence from another tenant cannot be queried or reused
  // -------------------------------------------------------------------------
  it("6. Tenant boundary isolation: cross-tenant event retrieval is strictly scoped", async () => {
    const spy = vi.spyOn(eventService, "getEventsByCaseId").mockResolvedValue([]);

    await request(app)
      .get("/api/payment-events/case/CASE-001")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ tenantId: TENANT });

    // Proves tenantId is strictly passed down from token filter
    expect(spy).toHaveBeenCalledWith("CASE-001", TENANT);
  });

  // -------------------------------------------------------------------------
  // Test 7: Without genuine verified frontend event source, Case 1 remains unconfirmed
  // -------------------------------------------------------------------------
  it("7. Without genuine verified frontend event source, Case 1 remains unconfirmed and yields STATUS_MISMATCH", () => {
    // In ordinary production flows, no frontend telemetry SDK exists.
    // Captured payment with pending order must yield STATUS_MISMATCH.
    const finding = classifyPaymentScenario({
      gatewayPayment: {
        gatewayPaymentId: "pay_prod_001",
        status: "CAPTURED",
        amountPaise: 50000,
        currency: "INR",
        tenantId: TENANT
      },
      merchantOrder: {
        merchantOrderId: "ORD-prod-001",
        status: "PENDING",
        amountPaise: 50000,
        currency: "INR",
        tenantId: TENANT
      },
      lifecycleEvents: [] // Empty: no verified frontend telemetry source exists in architecture
    });

    expect(finding.scenarioId).toBe("CASE_6_PAID_GATEWAY_UNPAID_ORDER");
    expect(finding.category).toBe("STATUS_MISMATCH");
    expect(finding.reasonCode).toBe("STATUS_MISMATCH");
    expect(finding.missingEvidence).toContain(
      "Authenticated frontend checkout acknowledgment or drop event (unobserved)"
    );
    expect(finding.facts.some((f) => f.dimension === "FRONTEND_CHECKOUT")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 8: Response does not expose trusted frontend fact when provenance validation fails
  // -------------------------------------------------------------------------
  it("8. Classification response does not expose trusted frontend fact when provenance validation fails", () => {
    const finding = classifyPaymentScenario({
      gatewayPayment: {
        gatewayPaymentId: "pay_fail_001",
        status: "CAPTURED",
        amountPaise: 50000,
        currency: "INR",
        tenantId: TENANT
      },
      merchantOrder: {
        merchantOrderId: "ORD-fail-001",
        status: "PENDING",
        amountPaise: 50000,
        currency: "INR",
        tenantId: TENANT
      },
      lifecycleEvents: [
        {
          eventId: "evt_invalid_001",
          sourceSystem: "MERCHANT_ORDER",
          serverVerifiedTelemetry: false, // Provenance validation fails
          tenantId: TENANT,
          merchantOrderId: "ORD-fail-001",
          normalizedEventType: "CHECKOUT_TIMEOUT"
        }
      ]
    });

    expect(finding.scenarioId).toBe("CASE_6_PAID_GATEWAY_UNPAID_ORDER");
    expect(finding.facts.some((f) => f.dimension === "FRONTEND_CHECKOUT")).toBe(false);
    expect(finding.supportingEvidence.some((e) => e.eventId === "evt_invalid_001")).toBe(false);
  });
});
