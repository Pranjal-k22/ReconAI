import fs from "node:fs";
import path from "node:path";
import { classifyPaymentScenario } from "../src/services/classification/evidenceClassifier.js";
import { CLASSIFICATION_SCENARIOS } from "../tests/helpers/classificationScenarios.js";

/**
 * Creates a recursive Proxy that records every property path accessed on an object.
 */
function createTracingProxy(target, basePath = "", readSet = new Set()) {
  if (target === null || typeof target !== "object") {
    return target;
  }

  // Handle Date, RegExp, Buffer instances directly without proxying methods
  if (target instanceof Date || target instanceof RegExp || Buffer.isBuffer(target)) {
    return target;
  }

  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "symbol" || prop === "inspect" || prop === "nodeType" || prop === "constructor") {
        return Reflect.get(obj, prop, receiver);
      }

      const propStr = String(prop);
      const currentPath = basePath ? `${basePath}.${propStr}` : propStr;

      // Filter out array standard helper methods from the business property read set
      const isArrayMethod = Array.isArray(obj) && [
        "length", "forEach", "map", "filter", "find", "some", "every", "reduce",
        "slice", "concat", "includes", "indexOf", "join", "entries", "values"
      ].includes(propStr);

      if (!isArrayMethod) {
        readSet.add(currentPath);
      }

      const value = Reflect.get(obj, prop, receiver);

      if (typeof value === "function") {
        return value.bind(obj);
      }

      if (value !== null && typeof value === "object") {
        return createTracingProxy(value, currentPath, readSet);
      }

      return value;
    }
  });
}

const traceResults = [];

for (const scenario of CLASSIFICATION_SCENARIOS) {
  const readSet = new Set();
  // Deep clone input fixture to prevent side-effects
  const rawInput = JSON.parse(JSON.stringify(scenario.input, (key, value) => {
    // Preserve date-like strings
    return value;
  }));

  // Reconstitute Date objects if present in original fixture
  if (scenario.input.gatewayPayment?.updatedAt) {
    rawInput.gatewayPayment.updatedAt = scenario.input.gatewayPayment.updatedAt;
  }
  if (scenario.input.merchantOrder?.updatedAt) {
    rawInput.merchantOrder.updatedAt = scenario.input.merchantOrder.updatedAt;
  }
  if (Array.isArray(scenario.input.lifecycleEvents)) {
    scenario.input.lifecycleEvents.forEach((evt, idx) => {
      if (evt.occurredAt && rawInput.lifecycleEvents?.[idx]) {
        rawInput.lifecycleEvents[idx].occurredAt = evt.occurredAt;
      }
    });
  }

  const proxiedInput = createTracingProxy(rawInput, "", readSet);

  const finding = classifyPaymentScenario(proxiedInput);

  traceResults.push({
    caseNumber: scenario.caseNum,
    scenarioId: finding.scenarioId,
    safeHoldCode: finding.safeHoldCode,
    readSet: Array.from(readSet).sort()
  });
}

// Print formatted output table
console.log("====================================================================================================");
console.log("RECONAI 2.0 - CLASSIFIER RUNTIME TRACING EVIDENCE (30 SCENARIOS)");
console.log("====================================================================================================");
for (const res of traceResults) {
  console.log(`Case #${String(res.caseNumber).padStart(2, "0")} | Scenario: ${res.scenarioId} | SafeHold: ${res.safeHoldCode}`);
  console.log(`  Read-Set (${res.readSet.length} fields):`);
  console.log(`    ${res.readSet.join(", ")}`);
  console.log("----------------------------------------------------------------------------------------------------");
}

// Save JSON artifact
const jsonPath = path.resolve("evidence/stage5/12-reachability-runtime-trace.json");
fs.writeFileSync(jsonPath, JSON.stringify(traceResults, null, 2), "utf8");
console.log(`\nRuntime trace saved to: ${jsonPath}`);
