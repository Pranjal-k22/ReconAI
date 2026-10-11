export const isSafeInteger = (value) => {
  if (value === null || value === undefined) return true;
  return Number.isSafeInteger(value);
};

export const isNonNegativeSafeInteger = (value) => {
  if (value === null || value === undefined) return true;
  return Number.isSafeInteger(value) && value >= 0;
};

/**
 * Supported currencies for ReconAI 2.0 active ledger.
 * The active ledger operates in integer paise within the Indian Rupee (INR) financial domain.
 */
export const SUPPORTED_CURRENCIES = Object.freeze(["INR"]);

/**
 * Validates currency strictly.
 * Rejects non-string, malformed (e.g. lowercase, non-3-letter, special characters),
 * and unsupported currencies.
 */
export const isValidCurrency = (value) => {
  if (typeof value !== "string") return false;
  return /^[A-Z]{3}$/.test(value) && SUPPORTED_CURRENCIES.includes(value);
};

/**
 * Sanitizes generic metadata objects to prevent arbitrary customer PII,
 * credentials, or unbounded nested objects from bypassing schema controls.
 */
export const sanitizeMetadata = (input = {}) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const forbiddenKeyPatterns = [
    /name/i,
    /email/i,
    /phone/i,
    /contact/i,
    /address/i,
    /card/i,
    /pan/i,
    /cvv/i,
    /token/i,
    /password/i,
    /secret/i,
    /vpa/i,
    /pin/i,
    /ssn/i,
    /dob/i
  ];

  const sanitized = {};
  const entries = Object.entries(input).slice(0, 10); // max 10 keys

  for (const [key, val] of entries) {
    if (typeof key !== "string" || key.length > 32 || !/^[a-zA-Z0-9_]+$/.test(key)) {
      continue;
    }
    if (forbiddenKeyPatterns.some((pattern) => pattern.test(key))) {
      continue;
    }
    // Only allow primitive values with strict length bounds
    if (typeof val === "string") {
      sanitized[key] = val.slice(0, 128).trim();
    } else if (typeof val === "number" && Number.isFinite(val)) {
      sanitized[key] = val;
    } else if (typeof val === "boolean") {
      sanitized[key] = val;
    }
  }

  return sanitized;
};
