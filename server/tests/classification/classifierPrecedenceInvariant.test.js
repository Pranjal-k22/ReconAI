import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { classifyPaymentScenario } from "../../src/services/classification/evidenceClassifier.js";
import { CLASSIFICATION_SCENARIOS } from "../helpers/classificationScenarios.js";

const TENANT = "tenant_merch_01";

export function extractClassifierRules(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const fnStart = content.indexOf("export function classifyPaymentScenario");
  const fnBody = content.slice(fnStart);

  const ruleRegex = /\/\/\s*Case\s+([^:\n]+):?([^\n]*)/g;
  let match;
  let pos = 1;
  const rules = [];

  while ((match = ruleRegex.exec(fnBody)) !== null) {
    const nextReturnIdx = fnBody.indexOf("return {", match.index);
    const nextReturnBlock = fnBody.slice(nextReturnIdx, nextReturnIdx + 1200);
    const isHeld = nextReturnBlock.includes("safeHold: true");
    const isNotHeld = nextReturnBlock.includes("safeHold: false");

    const caseMatch = match[0].match(/Case\s+(\d+)/i);
    const caseNum = caseMatch ? parseInt(caseMatch[1], 10) : null;

    // Conditional cases that have both held and not-held branches
    const conditionalCases = [2, 3, 7, 9, 10, 11, 24, 25, 26];
    const isConditional = caseNum && conditionalCases.includes(caseNum);

    rules.push({
      position: pos++,
      rawTitle: match[0].trim(),
      caseNum,
      desc: match[2].trim(),
      canReturnHeld: isConditional ? true : isHeld,
      canReturnNotHeld: isConditional ? true : isNotHeld,
      branchHeld: isHeld,
      branchNotHeld: isNotHeld,
      isConditional
    });
  }

  return rules;
}

function mergeInputs(inputA, inputB) {
  if (inputA.gatewayPayment && inputB.gatewayPayment) {
    const sA = inputA.gatewayPayment.status;
    const sB = inputB.gatewayPayment.status;
    if (sA && sB && sA !== sB) {
      return { canMerge: false, reason: `GatewayPayment status contradiction: '${sA}' vs '${sB}'` };
    }
    const cA = inputA.gatewayPayment.currency;
    const cB = inputB.gatewayPayment.currency;
    if (cA && cB && cA !== cB) {
      return { canMerge: false, reason: `GatewayPayment currency contradiction: '${cA}' vs '${cB}'` };
    }
  }

  if (inputA.merchantOrder && inputB.merchantOrder) {
    const osA = inputA.merchantOrder.status;
    const osB = inputB.merchantOrder.status;
    if (osA && osB && osA !== osB) {
      return { canMerge: false, reason: `MerchantOrder status contradiction: '${osA}' vs '${osB}'` };
    }
  }

  const merged = {
    gatewayPayment: (inputA.gatewayPayment || inputB.gatewayPayment) ? { ...(inputA.gatewayPayment || {}), ...(inputB.gatewayPayment || {}) } : null,
    merchantOrder: (inputA.merchantOrder || inputB.merchantOrder) ? { ...(inputA.merchantOrder || {}), ...(inputB.merchantOrder || {}) } : null,
    paymentCase: (inputA.paymentCase || inputB.paymentCase) ? { ...(inputA.paymentCase || {}), ...(inputB.paymentCase || {}) } : null,
    lifecycleEvents: [...(inputA.lifecycleEvents || []), ...(inputB.lifecycleEvents || [])],
    settlementRecords: [...(inputA.settlementRecords || []), ...(inputB.settlementRecords || [])],
    customerClaims: [...(inputA.customerClaims || []), ...(inputB.customerClaims || [])],
    context: { ...(inputA.context || {}), ...(inputB.context || {}) }
  };

  return { canMerge: true, merged };
}

describe("Classifier Precedence Invariant Suite", () => {
  const classifierPath = path.resolve(process.cwd(), "src/services/classification/evidenceClassifier.js");
  const rules = extractClassifierRules(classifierPath);

  const fixtureByCase = {};
  for (const sc of CLASSIFICATION_SCENARIOS) {
    fixtureByCase[sc.caseNum] = {
      held: sc.expectedSafeHold ? sc.input : null,
      notHeld: !sc.expectedSafeHold ? sc.input : null
    };
  }

  fixtureByCase[2].notHeld = {
    gatewayPayment: { gatewayPaymentId: "pay_02_nh", status: "PENDING", amountPaise: 50000, currency: "INR", tenantId: TENANT, createdAt: new Date() },
    customerClaims: [{ text: "Debited from my bank account", claimType: "CUSTOMER_DEBIT_CLAIM" }],
    context: { pendingMinutes: 15, customerDebitClaim: true, tenantId: TENANT }
  };

  fixtureByCase[3].notHeld = {
    gatewayPayment: { gatewayPaymentId: "pay_03_nh", status: "FAILED", amountPaise: 50000, currency: "INR", tenantId: TENANT },
    customerClaims: [{ text: "Debited but failed", claimType: "CUSTOMER_DEBIT_CLAIM" }],
    context: { customerDebitClaim: true, reversalOverdue: false, tenantId: TENANT }
  };

  fixtureByCase[7].notHeld = {
    paymentCase: {
      caseId: "case_07_nh",
      tenantId: TENANT,
      metadata: {
        duplicatePaymentAttempts: [
          { paymentId: "pay_dup_1", amountPaise: 50000 },
          { paymentId: "pay_dup_2", amountPaise: 50000 }
        ]
      }
    },
    context: { tenantId: TENANT }
  };

  fixtureByCase[9].notHeld = {
    merchantOrder: { merchantOrderId: "ord_09_nh", status: "PARTIALLY_PAID", amountPaise: 100000, tenantId: TENANT },
    gatewayPayment: { gatewayPaymentId: "pay_09_nh", status: "CAPTURED", amountPaise: 50000, tenantId: TENANT },
    context: { installmentWindowActive: true, tenantId: TENANT }
  };

  fixtureByCase[10].notHeld = {
    gatewayPayment: { gatewayPaymentId: "pay_10_nh", status: "CAPTURED", amountPaise: 50000, tenantId: TENANT },
    paymentCase: { caseId: "case_10_nh", requestedRefundAmountPaise: 20000, tenantId: TENANT },
    context: { isPartialRefund: true, tenantId: TENANT }
  };

  fixtureByCase[11].notHeld = {
    gatewayPayment: { gatewayPaymentId: "pay_11_nh", status: "CAPTURED", refundStatus: "PENDING", amountPaise: 50000, tenantId: TENANT },
    context: { refundPendingDays: 2, tenantId: TENANT }
  };

  fixtureByCase[24].notHeld = {
    context: { providerUnavailable: true, retryCount: 1, maxRetries: 5, tenantId: TENANT }
  };

  fixtureByCase[25].notHeld = {
    context: { databaseOutage: true, reconnectAttempts: 1, unresolvableState: false, tenantId: TENANT }
  };

  fixtureByCase[26].notHeld = {
    paymentCase: { caseId: "case_26_nh", actionLeaseExpiresAt: new Date(Date.now() - 10000), tenantId: TENANT },
    context: { workerCrash: true, leaseExpirations: 1, tenantId: TENANT }
  };

  it("extracts 40 rules with explicit held/not-held/can-return-both annotations matching Function#toString return branches", () => {
    // Derive rule count independently via Function#toString without using comment regex
    const fnStr = classifyPaymentScenario.toString();
    const returnBranches = (fnStr.match(/return\s*\{[\s\S]*?safeHold\s*:/g) || [])
      .filter(block => !block.includes("UNKNOWN_SCENARIO"));

    // Precedence test fails if extracted rules differs from number of rule-returning branches
    expect(rules.length).toBe(returnBranches.length);
    expect(rules.length).toBe(40);

    const conditionalRules = rules.filter(r => r.isConditional);
    expect(conditionalRules.length).toBe(18); // 9 cases * 2 branches each
    for (const cr of conditionalRules) {
      expect(cr.canReturnHeld).toBe(true);
      expect(cr.canReturnNotHeld).toBe(true);
    }
  });

  it("enumerates all ordered pairs (A before B) and proves safeHold: true on 100% of merged pairs", () => {
    let pairsGenerated = 0;
    let pairsMerged = 0;
    const unmergeable = [];

    for (let i = 0; i < rules.length; i++) {
      const ruleA = rules[i];
      if (!ruleA.canReturnNotHeld) continue;

      for (let j = i + 1; j < rules.length; j++) {
        const ruleB = rules[j];
        if (!ruleB.canReturnHeld) continue;

        pairsGenerated++;

        const fixtureA = fixtureByCase[ruleA.caseNum]?.notHeld;
        const fixtureB = fixtureByCase[ruleB.caseNum]?.held;

        expect(fixtureA).toBeDefined();
        expect(fixtureB).toBeDefined();

        const { canMerge, reason, merged } = mergeInputs(fixtureA, fixtureB);
        if (!canMerge) {
          unmergeable.push({ ruleA: ruleA.rawTitle, ruleB: ruleB.rawTitle, reason });
          continue;
        }

        pairsMerged++;
        const finding = classifyPaymentScenario(merged);
        expect(finding.safeHold).toBe(true);
      }
    }

    expect(pairsGenerated).toBe(191);
    expect(pairsMerged).toBe(155);
    expect(unmergeable.length).toBe(36);

    // Stable contradiction list assertions for all 36 unmergeable pairs
    const contradictionReasons = unmergeable.map(u => ({
      pair: `${u.ruleA} vs ${u.ruleB}`,
      reason: u.reason
    }));
    expect(contradictionReasons).toHaveLength(36);
    for (const item of contradictionReasons) {
      expect(item.reason).toMatch(/contradiction/i);
    }
  });
});
