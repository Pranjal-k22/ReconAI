import { describe, it, expect, vi } from "vitest";
import { PaymentAction, ACTION_TYPES, ACTION_STATUSES } from "../../src/models/PaymentAction.js";
import * as actionService from "../../src/services/ledger/paymentActionService.js";
import fs from "fs";
import path from "path";

describe("Phase 2 — PaymentAction Domain Model & Action Ledger Tests", () => {
  // Test 8: Action type and status allowlist enforcement
  it("8. Action type and status allowlist enforcement: rejects unknown types and statuses", async () => {
    // Invalid action type
    await expect(
      actionService.recordProposedAction({
        tenantId: "sh_merchant_alpha",
        caseId: "CASE-001",
        actionType: "ILLEGAL_UNRESTRICTED_PAYOUT",
        idempotencyKey: "IDEM-001",
        initiatedByActorType: "AI_PLANNER",
        initiatedByActorId: "planner-1",
        reasonCode: "TEST"
      })
    ).rejects.toThrow(/Invalid actionType/);

    // Schema level check on PaymentAction
    const badAction = new PaymentAction({
      actionId: "ACT-BAD-01",
      tenantId: "sh_merchant_alpha",
      caseId: "CASE-001",
      actionType: "WAIT_AND_MONITOR",
      actionStatus: "TOTALLY_BOGUS_STATUS",
      idempotencyKey: "IDEM-002",
      initiatedByActorType: "SYSTEM_MONITOR",
      initiatedByActorId: "monitor-1",
      reasonCode: "RECHECK"
    });

    await expect(badAction.validate()).rejects.toThrow();
  });

  // Test 8b: Phase 2 safety boundary enforces that external execution statuses are blocked
  it("8b. Phase 2 safety boundary: blocks external live execution statuses (EXECUTION_PENDING, EXECUTED_UNCONFIRMED)", async () => {
    await expect(
      actionService.recordProposedAction({
        tenantId: "sh_merchant_alpha",
        caseId: "CASE-001",
        actionType: "EXECUTE_PROVIDER_REFUND",
        actionStatus: "EXECUTED_UNCONFIRMED",
        idempotencyKey: "IDEM-UNAUTH-01",
        initiatedByActorType: "AI_PLANNER",
        initiatedByActorId: "planner-1",
        reasonCode: "ATTEMPTED_WRITE"
      })
    ).rejects.toThrow(/External financial action execution is disabled in Phase 2/);
  });

  // Test 9: Duplicate action idempotency-key handling
  it("9. Duplicate action idempotency-key handling returns existing record within tenant scope", async () => {
    const mockExisting = {
      actionId: "ACT-EXISTING-001",
      tenantId: "sh_merchant_alpha",
      idempotencyKey: "IDEM-REFUND-001",
      actionType: "SIMULATE_REFUND_CUSTOMER",
      actionStatus: "SIMULATED"
    };

    vi.spyOn(PaymentAction, "findOne").mockResolvedValue(mockExisting);

    const result = await actionService.recordProposedAction({
      tenantId: "sh_merchant_alpha",
      caseId: "CASE-001",
      actionType: "SIMULATE_REFUND_CUSTOMER",
      actionStatus: "SIMULATED",
      idempotencyKey: "IDEM-REFUND-001",
      initiatedByActorType: "AI_PLANNER",
      initiatedByActorId: "planner-1",
      reasonCode: "DUPLICATE_CHECK"
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.action.actionId).toBe("ACT-EXISTING-001");

    vi.restoreAllMocks();
  });

  // Test 10: Concurrent attempts to create the same logical action
  it("10. Concurrent race conditions on idempotency key resolve deterministically without double-creation", async () => {
    // Simulate first findOne returning null (race start), but Mongo throwing E11000 duplicate key on create
    vi.spyOn(PaymentAction, "findOne")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ actionId: "ACT-RACE-WINNER", idempotencyKey: "IDEM-RACE-001" });

    const mongoDuplicateError = new Error("E11000 duplicate key error");
    mongoDuplicateError.code = 11000;
    vi.spyOn(PaymentAction, "create").mockRejectedValue(mongoDuplicateError);

    const result = await actionService.recordProposedAction({
      tenantId: "sh_merchant_alpha",
      caseId: "CASE-001",
      actionType: "WAIT_AND_MONITOR",
      idempotencyKey: "IDEM-RACE-001",
      initiatedByActorType: "SYSTEM_MONITOR",
      initiatedByActorId: "monitor-1",
      reasonCode: "RACE_TEST"
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.action.actionId).toBe("ACT-RACE-WINNER");

    vi.restoreAllMocks();
  });

  // Test 11 & 12: Integer-paise validation on PaymentAction
  it("11-12. Monetary amounts in PaymentAction strictly enforce integer paise", async () => {
    const validAction = new PaymentAction({
      actionId: "ACT-MONEY-01",
      tenantId: "sh_merchant_alpha",
      caseId: "CASE-001",
      actionType: "SIMULATE_REFUND_CUSTOMER",
      actionStatus: "SIMULATED",
      idempotencyKey: "IDEM-VALID-MONEY",
      amountPaise: 150000,
      currency: "INR",
      initiatedByActorType: "POLICY_ENGINE",
      initiatedByActorId: "policy-1",
      reasonCode: "POLICY_APPROVED"
    });

    const err = await validAction.validate();
    expect(err).toBeUndefined();

    // Invalid negative amount
    const negativeAction = new PaymentAction({
      actionId: "ACT-NEG-01",
      tenantId: "sh_merchant_alpha",
      caseId: "CASE-001",
      actionType: "SIMULATE_REFUND_CUSTOMER",
      idempotencyKey: "IDEM-NEG",
      amountPaise: -50,
      initiatedByActorType: "POLICY_ENGINE",
      initiatedByActorId: "policy-1",
      reasonCode: "BAD"
    });

    await expect(negativeAction.validate()).rejects.toThrow();
  });

  // Test 15: Static Architecture Guard: Proves zero code paths in Phase 2 trigger payment provider writes
  it("15. Static Architecture Guard: ledger services contain ZERO payment provider write calls", () => {
    const ledgerDir = path.resolve(__dirname, "../../src/services/ledger");
    const files = fs.readdirSync(ledgerDir).filter((f) => f.endsWith(".js"));

    expect(files.length).toBeGreaterThan(0);

    const forbiddenWritePatterns = [
      "createRefund",
      "capturePayment",
      "transferFunds",
      "postRefund",
      "/v1/payments/",
      "POST",
      "razorpay.refunds.create",
      "fetchRazorpayApi"
    ];

    for (const file of files) {
      const filePath = path.join(ledgerDir, file);
      const content = fs.readFileSync(filePath, "utf-8");

      for (const pattern of forbiddenWritePatterns) {
        expect(
          content.includes(pattern),
          `Forbidden provider write pattern '${pattern}' detected in ${file}`
        ).toBe(false);
      }
    }
  });
});
