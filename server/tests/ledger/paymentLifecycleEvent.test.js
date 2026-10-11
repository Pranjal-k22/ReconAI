import { describe, it, expect, vi } from "vitest";
import { PaymentLifecycleEvent } from "../../src/models/PaymentLifecycleEvent.js";
import * as eventService from "../../src/services/ledger/paymentLifecycleEventService.js";
import { AppError } from "../../src/utils/AppError.js";

describe("Phase 2 — PaymentLifecycleEvent Domain Model & Service Tests", () => {
  // Test 4: Valid event creation with correct provenance and timestamps
  it("4. Valid event creation with correct provenance, fingerprints, and timestamps", async () => {
    const rawPayload = {
      razorpayPaymentId: "pay_TEST123",
      status: "captured",
      amount: 250000
    };

    const sanitized = eventService.sanitizeLifecyclePayload(rawPayload);
    const fingerprint = eventService.calculatePayloadFingerprint(sanitized);

    const event = new PaymentLifecycleEvent({
      eventId: "EVT-20261011-0001",
      tenantId: "sh_merchant_alpha",
      caseId: "CASE-001",
      sourceSystem: "GATEWAY_WEBHOOK",
      sourceEventId: "evt_razorpay_9981",
      deduplicationKey: "sh_merchant_alpha:GATEWAY_WEBHOOK:evt_razorpay_9981",
      normalizedEventType: "PAYMENT_CAPTURED",
      merchantOrderId: "ORD-101",
      gatewayPaymentId: "pay_TEST123",
      amountPaise: 250000,
      currency: "INR",
      providerOccurredAt: new Date("2026-10-11T12:00:00Z"),
      sourceObservedAt: new Date("2026-10-11T12:00:02Z"),
      ingestedAt: new Date(),
      normalizedPayload: sanitized,
      payloadFingerprint: fingerprint,
      schemaVersion: "1.0.0",
      provenance: { ip: "127.0.0.1", webhookDeliveryId: "del_1" }
    });

    const err = await event.validate();
    expect(err).toBeUndefined();
    expect(event.payloadFingerprint).toBe(fingerprint);
    expect(event.providerOccurredAt).toBeInstanceOf(Date);
  });

  // Test 5: Duplicate identifiable source-event deterministic reporting
  it("5. Duplicate identifiable source-event reporting returns existing record", async () => {
    const mockExistingEvent = {
      eventId: "EVT-EXISTING-01",
      deduplicationKey: "sh_merchant_alpha:GATEWAY_WEBHOOK:evt_razorpay_9981",
      normalizedEventType: "PAYMENT_CAPTURED"
    };

    vi.spyOn(PaymentLifecycleEvent, "findOne").mockResolvedValue(mockExistingEvent);

    const res = await eventService.appendLifecycleEvent({
      tenantId: "sh_merchant_alpha",
      sourceSystem: "GATEWAY_WEBHOOK",
      sourceEventId: "evt_razorpay_9981",
      normalizedEventType: "PAYMENT_CAPTURED",
      rawPayload: { id: "pay_1" }
    });

    expect(res.isDuplicate).toBe(true);
    expect(res.event.eventId).toBe("EVT-EXISTING-01");

    vi.restoreAllMocks();
  });

  // Test 6: Correct handling of events without source event IDs
  it("6. Correct handling of events without source event IDs via deterministic content fingerprint", () => {
    const payloadA = { note: "Customer claims debited via UPI", utr: "998877665544" };
    const sanitizedA = eventService.sanitizeLifecyclePayload(payloadA);
    const fingerprintA = eventService.calculatePayloadFingerprint(sanitizedA);

    const key1 = eventService.generateDeduplicationKey({
      tenantId: "sh_merchant_alpha",
      sourceSystem: "CUSTOMER_CLAIM",
      sourceEventId: null,
      normalizedEventType: "CUSTOMER_DEBIT_CLAIM_SUBMITTED",
      merchantOrderId: "ORD-505",
      payloadFingerprint: fingerprintA
    });

    // Identical payload yields identical deduplication key
    const key2 = eventService.generateDeduplicationKey({
      tenantId: "sh_merchant_alpha",
      sourceSystem: "CUSTOMER_CLAIM",
      sourceEventId: null,
      normalizedEventType: "CUSTOMER_DEBIT_CLAIM_SUBMITTED",
      merchantOrderId: "ORD-505",
      payloadFingerprint: fingerprintA
    });

    expect(key1).toBe(key2);

    // Different payload yields different fingerprint and different key
    const payloadB = { note: "Customer claims debited via Netbanking", utr: "112233445566" };
    const sanitizedB = eventService.sanitizeLifecyclePayload(payloadB);
    const fingerprintB = eventService.calculatePayloadFingerprint(sanitizedB);

    const key3 = eventService.generateDeduplicationKey({
      tenantId: "sh_merchant_alpha",
      sourceSystem: "CUSTOMER_CLAIM",
      sourceEventId: null,
      normalizedEventType: "CUSTOMER_DEBIT_CLAIM_SUBMITTED",
      merchantOrderId: "ORD-505",
      payloadFingerprint: fingerprintB
    });

    expect(key1).not.toBe(key3);
  });

  // Test 7: Append-only invariant enforcement (no update/delete)
  it("7. Append-only invariant: update and delete operations are rejected by service", async () => {
    await expect(eventService.updateLifecycleEvent()).rejects.toThrow(/append-only/i);
    await expect(eventService.deleteLifecycleEvent()).rejects.toThrow(/append-only/i);
  });

  // Test 13: Sanitization and minimization of sensitive fields
  it("13. Sanitization of sensitive fields: strips PAN, CVV, passwords, cardholder data, customer PII", () => {
    const dirtyPayload = {
      paymentId: "pay_123",
      amount: 1000,
      card: {
        number: "4111111111111111",
        cvv: "123",
        expiry_month: "12",
        expiry_year: "2028"
      },
      password: "secret_login_pass",
      api_key: "rzp_test_secret123",
      email: "victim@example.com",
      contact: "+919876543210",
      vpa: "user@okhdfcbank",
      orderRef: "ORD-001"
    };

    const clean = eventService.sanitizeLifecyclePayload(dirtyPayload);

    expect(clean.card).toBeUndefined();
    expect(clean.password).toBeUndefined();
    expect(clean.api_key).toBeUndefined();
    expect(clean.email).toBeUndefined();
    expect(clean.contact).toBeUndefined();
    expect(clean.vpa).toBeUndefined();
    // Non-sensitive fields are preserved
    expect(clean.paymentId).toBe("pay_123");
    expect(clean.amount).toBe(1000);
    expect(clean.orderRef).toBe("ORD-001");
  });

  // Test 14: Database/index failures do not produce false success
  it("14. Database failures do not produce false success: re-throws persistence exceptions", async () => {
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
