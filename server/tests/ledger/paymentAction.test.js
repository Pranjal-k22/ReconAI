import { describe, it, expect, vi } from "vitest";
import { PaymentAction, ACTION_TYPES, ACTION_STATUSES } from "../../src/models/PaymentAction.js";
import * as actionService from "../../src/services/ledger/paymentActionService.js";
import fs from "fs";
import path from "path";

describe("Phase 2 — PaymentAction Domain Model & Action Ledger Tests", () => {
  // Test 1: Valid Phase 2 intent statuses are accepted
  it("1. Accepts valid Phase 2 non-executing intent statuses", async () => {
    const validStatuses = ["PROPOSED", "SIMULATED", "REJECTED_BY_POLICY", "HELD_IN_SAFE_HOLD"];

    for (const status of validStatuses) {
      const actionDoc = new PaymentAction({
        actionId: `ACT-STATUS-${status}`,
        tenantId: "sh_merchant_alpha",
        caseId: "CASE-001",
        actionType: "WAIT_AND_MONITOR",
        actionStatus: status,
        idempotencyKey: `IDEM-${status}`,
        initiatedByActorType: "AI_PLANNER",
        initiatedByActorId: "planner-1",
        reasonCode: "TEST"
      });

      const err = await actionDoc.validate();
      expect(err).toBeUndefined();
    }
  });

  // Test 2: Rejection of execution-ready status (READY_FOR_EXECUTION)
  it("2. Rejects execution-ready status (READY_FOR_EXECUTION)", async () => {
    await expect(
      actionService.recordProposedAction({
        tenantId: "sh_merchant_alpha",
        caseId: "CASE-001",
        actionType: "EXECUTE_PROVIDER_REFUND",
        actionStatus: "READY_FOR_EXECUTION",
        idempotencyKey: "IDEM-READY-01",
        initiatedByActorType: "POLICY_ENGINE",
        initiatedByActorId: "policy-1",
        reasonCode: "READY_TEST"
      })
    ).rejects.toThrow(/Action execution or authorization is prohibited in Phase 2/);
  });

  // Test 3: Rejection of execution-in-progress and execution-completed statuses
  it("3. Rejects execution statuses (EXECUTION_PENDING, EXECUTED, VERIFIED_SUCCESS, POLICY_AUTHORIZED)", async () => {
    const forbiddenStatuses = [
      "EXECUTION_PENDING",
      "EXECUTED_UNCONFIRMED",
      "EXECUTED",
      "VERIFICATION_PENDING",
      "VERIFIED_SUCCESS",
      "POLICY_AUTHORIZED",
      "EXECUTION_FAILED"
    ];

    for (const status of forbiddenStatuses) {
      await expect(
        actionService.recordProposedAction({
          tenantId: "sh_merchant_alpha",
          caseId: "CASE-001",
          actionType: "EXECUTE_PROVIDER_REFUND",
          actionStatus: status,
          idempotencyKey: `IDEM-${status}`,
          initiatedByActorType: "AI_PLANNER",
          initiatedByActorId: "planner-1",
          reasonCode: "FORBIDDEN_EXECUTION"
        })
      ).rejects.toThrow(/Action execution or authorization is prohibited in Phase 2/);
    }
  });

  // Test 4: Rejection of arbitrary and malformed status strings
  it("4. Rejects arbitrary and malformed status strings at schema and service layers", async () => {
    await expect(
      actionService.recordProposedAction({
        tenantId: "sh_merchant_alpha",
        caseId: "CASE-001",
        actionType: "WAIT_AND_MONITOR",
        actionStatus: "ARBITRARY_CUSTOM_STATUS",
        idempotencyKey: "IDEM-ARB-01",
        initiatedByActorType: "SYSTEM_MONITOR",
        initiatedByActorId: "monitor-1",
        reasonCode: "MALFORMED"
      })
    ).rejects.toThrow(/Action execution or authorization is prohibited in Phase 2/);

    const badSchemaAction = new PaymentAction({
      actionId: "ACT-BAD-01",
      tenantId: "sh_merchant_alpha",
      caseId: "CASE-001",
      actionType: "WAIT_AND_MONITOR",
      actionStatus: "RANDOM_STRING_XYZ",
      idempotencyKey: "IDEM-SCHEMA-BAD",
      initiatedByActorType: "SYSTEM_MONITOR",
      initiatedByActorId: "monitor-1",
      reasonCode: "TEST"
    });

    await expect(badSchemaAction.validate()).rejects.toThrow();
  });

  // Test 5: Currency validation on PaymentAction
  it("5. Currency validation: enforces INR and rejects lowercase or unsupported currencies", async () => {
    const badCurrencyAction = new PaymentAction({
      actionId: "ACT-BAD-CURR",
      tenantId: "sh_merchant_alpha",
      caseId: "CASE-001",
      actionType: "WAIT_AND_MONITOR",
      actionStatus: "PROPOSED",
      idempotencyKey: "IDEM-CURR-01",
      currency: "usd",
      initiatedByActorType: "AI_PLANNER",
      initiatedByActorId: "planner-1",
      reasonCode: "TEST"
    });
    await expect(badCurrencyAction.validate()).rejects.toThrow(/currency/i);

    await expect(
      actionService.recordProposedAction({
        tenantId: "sh_merchant_alpha",
        caseId: "CASE-001",
        actionType: "WAIT_AND_MONITOR",
        idempotencyKey: "IDEM-SERVICE-CURR",
        currency: "GBP",
        initiatedByActorType: "AI_PLANNER",
        initiatedByActorId: "planner-1",
        reasonCode: "TEST"
      })
    ).rejects.toThrow(/Invalid or unsupported currency/i);
  });

  // Test 6: Scoped idempotency deduplication
  it("6. Duplicate action idempotency-key returns existing record without re-creation", async () => {
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

  // Test 7: Concurrent race conditions resolve deterministically (E11000)
  it("7. Concurrent race condition handling resolves deterministically without double creation", async () => {
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

  // Test 8: Metadata minimization on PaymentAction
  it("8. Metadata minimization: strips customer PII and nested structures from PaymentAction", () => {
    const actionDoc = new PaymentAction({
      actionId: "ACT-META-001",
      tenantId: "sh_merchant_alpha",
      caseId: "CASE-001",
      actionType: "SIMULATE_REFUND_CUSTOMER",
      actionStatus: "SIMULATED",
      idempotencyKey: "IDEM-META-01",
      initiatedByActorType: "POLICY_ENGINE",
      initiatedByActorId: "policy-1",
      reasonCode: "POLICY_APPROVED",
      metadata: {
        simulationRunId: "SIM-882",
        customerContact: "+919876543210",
        nestedInfo: { key: "secret" }
      }
    });

    expect(actionDoc.metadata.simulationRunId).toBe("SIM-882");
    expect(actionDoc.metadata.customerContact).toBeUndefined();
    expect(actionDoc.metadata.nestedInfo).toBeUndefined();
  });

  // Test 9: Integer-paise monetary amounts
  it("9. Monetary amounts strictly enforce integer paise", async () => {
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

  // Test 10: Static Architecture Guard: Proves zero code paths in Phase 2 trigger payment provider writes
  it("10. Static Architecture Guard: ledger services contain ZERO payment provider write calls", () => {
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
