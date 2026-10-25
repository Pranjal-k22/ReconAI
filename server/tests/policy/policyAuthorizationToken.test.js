import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  issuePolicyAuthorizationToken,
  verifyPolicyAuthorizationToken,
  UnauthorizedActionExecutionError
} from "../../src/services/policy/policyAuthorizationToken.js";
import { ProviderOperation } from "../../src/models/ProviderOperation.js";

describe("PolicyAuthorizationToken Cryptographic Token Engine (Gate B3)", () => {
  const originalEnv = { ...process.env };
  const TEST_SECRET = "super-secret-policy-token-key-min-32-chars!";

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.POLICY_TOKEN_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const baseParams = {
    tenantId: "tenant_alpha",
    caseId: "case_001",
    policyDecisionId: "pdec_123",
    actionType: "REQUEST_REFUND",
    gatewayPaymentId: "pay_xyz",
    amountPaise: 25000,
    currency: "INR",
    idempotencyKey: "idem_abc_123",
    policyVersion: "1.0.0",
    ttlSeconds: 120
  };

  it("issues a valid cryptographically signed token with correct payload structure", async () => {
    const { token, tokenId, expiresAt } = await issuePolicyAuthorizationToken(baseParams);

    expect(token).toBeTypeOf("string");
    expect(tokenId).toBeTypeOf("string");
    expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const parts = token.split(".");
    expect(parts.length).toBe(2);

    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    expect(payload.version).toBe("1.0.0");
    expect(payload.tokenId).toBe(tokenId);
    expect(payload.tenantId).toBe("tenant_alpha");
    expect(payload.caseId).toBe("case_001");
    expect(payload.policyDecisionId).toBe("pdec_123");
    expect(payload.actionType).toBe("REQUEST_REFUND");
    expect(payload.gatewayPaymentId).toBe("pay_xyz");
    expect(payload.amountPaise).toBe(25000);
    expect(payload.currency).toBe("INR");
    expect(payload.idempotencyKey).toBe("idem_abc_123");
  });

  it("clamps TTL to maximum 300 seconds and minimum 1 second", async () => {
    const nowMs = 1700000000000;
    const nowSec = Math.floor(nowMs / 1000);

    const { expiresAt: expMax } = await issuePolicyAuthorizationToken({
      ...baseParams,
      ttlSeconds: 1000, // over 300
      nowMs
    });
    expect(expMax).toBe(nowSec + 300);

    const { expiresAt: expMin } = await issuePolicyAuthorizationToken({
      ...baseParams,
      ttlSeconds: -10, // under 1
      nowMs
    });
    expect(expMin).toBe(nowSec + 1);
  });

  it("successfully verifies a valid token against matching expected properties", async () => {
    const { token } = await issuePolicyAuthorizationToken(baseParams);

    const decoded = await verifyPolicyAuthorizationToken({
      token,
      expectedTenantId: "tenant_alpha",
      expectedCaseId: "case_001",
      expectedPaymentId: "pay_xyz",
      expectedActionType: "REQUEST_REFUND",
      expectedAmountPaise: 25000,
      expectedCurrency: "INR",
      expectedIdempotencyKey: "idem_abc_123"
    });

    expect(decoded.tenantId).toBe("tenant_alpha");
    expect(decoded.amountPaise).toBe(25000);
  });

  it("refuses token when signature length mismatches without throwing timingSafeEqual length error", async () => {
    const { token } = await issuePolicyAuthorizationToken(baseParams);
    const [payloadB64] = token.split(".");
    // Shorter signature
    const malformedSig = Buffer.from("short-sig").toString("base64url");
    const badToken = `${payloadB64}.${malformedSig}`;

    await expect(
      verifyPolicyAuthorizationToken({
        token: badToken,
        expectedTenantId: "tenant_alpha",
        expectedCaseId: "case_001",
        expectedPaymentId: "pay_xyz",
        expectedActionType: "REQUEST_REFUND",
        expectedAmountPaise: 25000,
        expectedCurrency: "INR",
        expectedIdempotencyKey: "idem_abc_123"
      })
    ).rejects.toThrow(/signature length mismatch/);
  });

  it("refuses token when signed with a different secret", async () => {
    const { token } = await issuePolicyAuthorizationToken({
      ...baseParams,
      customSecret: "different-secret-for-testing-purposes-32-chars!"
    });

    await expect(
      verifyPolicyAuthorizationToken({
        token,
        expectedTenantId: "tenant_alpha",
        expectedCaseId: "case_001",
        expectedPaymentId: "pay_xyz",
        expectedActionType: "REQUEST_REFUND",
        expectedAmountPaise: 25000,
        expectedCurrency: "INR",
        expectedIdempotencyKey: "idem_abc_123"
      })
    ).rejects.toThrow(/invalid signature/);
  });

  it("refuses expired token using clock injection", async () => {
    const baseTime = 1700000000000;
    const { token } = await issuePolicyAuthorizationToken({
      ...baseParams,
      ttlSeconds: 60,
      nowMs: baseTime
    });

    // Verify 61 seconds later -> expired
    await expect(
      verifyPolicyAuthorizationToken({
        token,
        expectedTenantId: "tenant_alpha",
        expectedCaseId: "case_001",
        expectedPaymentId: "pay_xyz",
        expectedActionType: "REQUEST_REFUND",
        expectedAmountPaise: 25000,
        expectedCurrency: "INR",
        expectedIdempotencyKey: "idem_abc_123",
        nowMs: baseTime + 61000
      })
    ).rejects.toThrow(/expired/);
  });

  describe("Tamper testing every payload field", () => {
    const fieldsToTamper = [
      { field: "amountPaise", badVal: 99999 },
      { field: "tenantId", badVal: "tenant_evil" },
      { field: "caseId", badVal: "case_tampered" },
      { field: "gatewayPaymentId", badVal: "pay_tampered" },
      { field: "actionType", badVal: "UNAUTHORIZED_ACTION" },
      { field: "idempotencyKey", badVal: "tampered_idem" },
      { field: "currency", badVal: "USD" },
      { field: "version", badVal: "2.0.0" },
      { field: "policyVersion", badVal: "9.9.9" },
      { field: "expiresAt", badVal: 9999999999 }
    ];

    for (const { field, badVal } of fieldsToTamper) {
      it(`refuses token when ${field} is tampered in payload`, async () => {
        const { token } = await issuePolicyAuthorizationToken(baseParams);
        const [payloadB64, sig] = token.split(".");
        const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
        payload[field] = badVal;

        const tamperedB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
        const tamperedToken = `${tamperedB64}.${sig}`;

        await expect(
          verifyPolicyAuthorizationToken({
            token: tamperedToken,
            expectedTenantId: "tenant_alpha",
            expectedCaseId: "case_001",
            expectedPaymentId: "pay_xyz",
            expectedActionType: "REQUEST_REFUND",
            expectedAmountPaise: 25000,
            expectedCurrency: "INR",
            expectedIdempotencyKey: "idem_abc_123"
          })
        ).rejects.toThrow(/signature verification failed/);
      });
    }
  });

  it("refuses replay when tokenId has already been recorded on a ProviderOperation", async () => {
    const { token, tokenId } = await issuePolicyAuthorizationToken(baseParams);

    // Mock ProviderOperation.findOne returning an existing operation record
    vi.spyOn(ProviderOperation, "findOne").mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        operationId: "OP-EXISTING-123",
        tokenId
      })
    });

    await expect(
      verifyPolicyAuthorizationToken({
        token,
        expectedTenantId: "tenant_alpha",
        expectedCaseId: "case_001",
        expectedPaymentId: "pay_xyz",
        expectedActionType: "REQUEST_REFUND",
        expectedAmountPaise: 25000,
        expectedCurrency: "INR",
        expectedIdempotencyKey: "idem_abc_123"
      })
    ).rejects.toThrow(/already been consumed \(replay rejected\)/);
  });
});
