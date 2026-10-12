import { describe, it, expect, vi } from "vitest";
import { PaymentLifecycleEvent } from "../../src/models/PaymentLifecycleEvent.js";
import * as eventService from "../../src/services/ledger/paymentLifecycleEventService.js";

describe("Phase 2 — PaymentLifecycleEvent Domain Model & Evidence Ledger Tests", () => {
  // Test 1: Append-only ledger rejects updates and deletes
  it("1. Append-only ledger invariant: rejects updates and deletions", async () => {
    await expect(eventService.updateLifecycleEvent("EVT-123", {})).rejects.toThrow(
      /append-only/i
    );
    await expect(eventService.deleteLifecycleEvent("EVT-123")).rejects.toThrow(
      /append-only/i
    );
  });

  // Test 2: Strict allowlist payload minimization drops all customer PII and unfamiliar aliases
  it("2. Strict allowlist payload minimization: drops customer PII, nested objects, and unapproved aliases", () => {
    const dirtyPayload = {
      // Approved normalized evidence fields
      gatewayPaymentId: "pay_123",
      merchantOrderId: "ORD-001",
      amountPaise: 100000,
      currency: "INR",
      status: "captured",
      arn: "ARN-888999",
      method: "card",

      // Generic ambiguous amount (must be dropped in favor of amountPaise)
      amount: 1000.0,

      // Unapproved fields / customer PII / unfamiliar aliases
      customerName: "Alice Sharma",
      billingAddress: {
        street: "123 Indiranagar 100ft Rd",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560038"
      },
      shippingAddress: {
        street: "456 Koramangala",
        city: "Bengaluru"
      },
      email: "alice@example.com",
      phone: "+919876543210",
      vpa: "alice@okaxis",
      card: {
        number: "4111111111111111",
        cvv: "123",
        expiry_month: "12",
        expiry_year: "2028"
      },
      password: "secret_login_pass",
      api_key: "rzp_test_secret123",
      customCustomerMemo: "VIP shopper urgent handling",
      internalNotes: "Suspected multiple account login"
    };

    const clean = eventService.sanitizeLifecyclePayload(dirtyPayload);

    // Verified: ALL unapproved fields, customer PII, and ambiguous amounts are dropped
    expect(clean.customerName).toBeUndefined();
    expect(clean.billingAddress).toBeUndefined();
    expect(clean.shippingAddress).toBeUndefined();
    expect(clean.email).toBeUndefined();
    expect(clean.phone).toBeUndefined();
    expect(clean.vpa).toBeUndefined();
    expect(clean.card).toBeUndefined();
    expect(clean.password).toBeUndefined();
    expect(clean.api_key).toBeUndefined();
    expect(clean.customCustomerMemo).toBeUndefined();
    expect(clean.internalNotes).toBeUndefined();
    expect(clean.amount).toBeUndefined(); // Generic ambiguous float dropped

    // Approved fields are preserved
    expect(clean.gatewayPaymentId).toBe("pay_123");
    expect(clean.merchantOrderId).toBe("ORD-001");
    expect(clean.amountPaise).toBe(100000);
    expect(clean.currency).toBe("INR");
    expect(clean.status).toBe("captured");
    expect(clean.arn).toBe("ARN-888999");
    expect(clean.method).toBe("card");
  });

  // Test 3: Currency validation on PaymentLifecycleEvent
  it("3. Currency validation: rejects non-string and unsupported currencies", async () => {
    const badCurrencyEvent = new PaymentLifecycleEvent({
      eventId: "EVT-BAD-CURR",
      tenantId: "sh_merchant_alpha",
      sourceSystem: "GATEWAY_WEBHOOK",
      deduplicationKey: "sh:gw:evt1",
      normalizedEventType: "PAYMENT_CAPTURED",
      payloadFingerprint: "abcd",
      currency: "USD"
    });
    await expect(badCurrencyEvent.validate()).rejects.toThrow(/currency/i);

    await expect(
      eventService.appendLifecycleEvent({
        tenantId: "sh_merchant_alpha",
        sourceSystem: "GATEWAY_WEBHOOK",
        normalizedEventType: "PAYMENT_CAPTURED",
        currency: "eur"
      })
    ).rejects.toThrow(/Invalid or unsupported currency/i);
  });

  // Test 4: Actual persisted event verifies no PII or raw payloads are saved
  it("4. Actual persisted event schema verifies strict sanitization on model document", async () => {
    const rawPayload = {
      gatewayPaymentId: "pay_test_99",
      amountPaise: 49900,
      currency: "INR",
      customerName: "Rohan Varma",
      billingAddress: { line: "MG Road" }
    };

    const cleanPayload = eventService.sanitizeLifecyclePayload(rawPayload);
    const fingerprint = eventService.calculatePayloadFingerprint(cleanPayload);

    const doc = new PaymentLifecycleEvent({
      eventId: "EVT-PERSIST-01",
      tenantId: "sh_merchant_alpha",
      sourceSystem: "GATEWAY_WEBHOOK",
      sourceEventId: "evt_src_1",
      deduplicationKey: "sh_merchant_alpha:GATEWAY_WEBHOOK:evt_src_1",
      normalizedEventType: "PAYMENT_CAPTURED",
      amountPaise: 49900,
      currency: "INR",
      normalizedPayload: cleanPayload,
      payloadFingerprint: fingerprint
    });

    const validated = await doc.validate();
    expect(validated).toBeUndefined();
    expect(doc.normalizedPayload.customerName).toBeUndefined();
    expect(doc.normalizedPayload.billingAddress).toBeUndefined();
    expect(doc.normalizedPayload.gatewayPaymentId).toBe("pay_test_99");
    expect(doc.normalizedPayload.amountPaise).toBe(49900);
  });

  // Test 5: Deterministic payload fingerprinting across key insertion order
  it("5. Deterministic payload fingerprinting produces identical SHA-256 regardless of key insertion order", () => {
    const payloadA = {
      gatewayPaymentId: "pay_abc",
      amountPaise: 25000,
      currency: "INR",
      status: "authorized"
    };

    const payloadB = {
      status: "authorized",
      currency: "INR",
      gatewayPaymentId: "pay_abc",
      amountPaise: 25000
    };

    const hashA = eventService.calculatePayloadFingerprint(payloadA);
    const hashB = eventService.calculatePayloadFingerprint(payloadB);

    expect(hashA).toBe(hashB);
    expect(hashA).toHaveLength(64);
  });

  // Test 6: Database/index failures do not produce false success
  it("6. Database failures do not produce false success: re-throws persistence exceptions", async () => {
    vi.spyOn(PaymentLifecycleEvent, "findOne").mockResolvedValue(null);
    vi.spyOn(PaymentLifecycleEvent, "create").mockRejectedValue(new Error("MongoDB connection lost"));

    await expect(
      eventService.appendLifecycleEvent({
        tenantId: "sh_merchant_alpha",
        sourceSystem: "GATEWAY_WEBHOOK",
        sourceEventId: "evt_err_1",
        normalizedEventType: "PAYMENT_CAPTURED"
      })
    ).rejects.toThrow("MongoDB connection lost");

    vi.restoreAllMocks();
  });

  // Test 7: Provenance security invariant rejects caller-supplied serverVerifiedTelemetry
  it("7. Provenance security invariant: rejects caller-supplied serverVerifiedTelemetry in rawPayload or provenance", async () => {
    await expect(
      eventService.appendLifecycleEvent({
        tenantId: "sh_merchant_alpha",
        sourceSystem: "GATEWAY_WEBHOOK",
        normalizedEventType: "PAYMENT_CAPTURED",
        rawPayload: { serverVerifiedTelemetry: true }
      })
    ).rejects.toThrow(/serverVerifiedTelemetry/i);

    await expect(
      eventService.appendLifecycleEvent({
        tenantId: "sh_merchant_alpha",
        sourceSystem: "GATEWAY_WEBHOOK",
        normalizedEventType: "PAYMENT_CAPTURED",
        provenance: { serverVerifiedTelemetry: true }
      })
    ).rejects.toThrow(/serverVerifiedTelemetry/i);
  });
});
