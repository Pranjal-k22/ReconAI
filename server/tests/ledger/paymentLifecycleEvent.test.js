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

    // Verified: ALL unapproved fields and arbitrary customer PII are dropped
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

    // Approved fields are preserved
    expect(clean.gatewayPaymentId).toBe("pay_123");
    expect(clean.merchantOrderId).toBe("ORD-001");
    expect(clean.amountPaise).toBe(100000);
    expect(clean.currency).toBe("INR");
    expect(clean.status).toBe("captured");
    expect(clean.arn).toBe("ARN-888999");
    expect(clean.method).toBe("card");
  });

  // Test 3: Unknown keys cannot be persisted merely because they don't match traditional denylists
  it("3. Unknown keys cannot be persisted even if absent from traditional denylists", () => {
    const unknownInput = {
      gatewayPaymentId: "pay_test_99",
      unfamiliarMetadataAttribute: "unvetted-value",
      customerFavoriteColor: "blue",
      riskScoreVendorX: "782",
      nestedUnknownObject: { a: 1, b: 2 }
    };

    const result = eventService.sanitizeLifecyclePayload(unknownInput);

    expect(result.gatewayPaymentId).toBe("pay_test_99");
    expect(result.unfamiliarMetadataAttribute).toBeUndefined();
    expect(result.customerFavoriteColor).toBeUndefined();
    expect(result.riskScoreVendorX).toBeUndefined();
    expect(result.nestedUnknownObject).toBeUndefined();
  });

  // Test 4: Deterministic payload fingerprinting across key insertion order
  it("4. Deterministic payload fingerprinting produces identical SHA-256 regardless of key insertion order", () => {
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

  // Test 5: Scoped deduplication with and without sourceEventId
  it("5. Scoped deduplication with and without sourceEventId", () => {
    const keyWithSource = eventService.generateDeduplicationKey({
      tenantId: "sh_merchant_alpha",
      sourceSystem: "GATEWAY_WEBHOOK",
      sourceEventId: "evt_razorpay_9981",
      normalizedEventType: "PAYMENT_CAPTURED",
      payloadFingerprint: "deadbeef"
    });
    expect(keyWithSource).toBe("sh_merchant_alpha:GATEWAY_WEBHOOK:evt_razorpay_9981");

    const keyWithoutSource = eventService.generateDeduplicationKey({
      tenantId: "sh_merchant_alpha",
      sourceSystem: "RECONAI_SYSTEM",
      sourceEventId: null,
      normalizedEventType: "INCONSISTENCY_DETECTED",
      merchantOrderId: "ORD-554",
      gatewayPaymentId: "pay_667",
      payloadFingerprint: "abcdef0123456789abcdef0123456789"
    });
    expect(keyWithoutSource).toContain("sh_merchant_alpha:RECONAI_SYSTEM:INCONSISTENCY_DETECTED:ORD-554:");
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
});
