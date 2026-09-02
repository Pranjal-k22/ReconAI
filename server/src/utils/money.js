import { AppError } from "./AppError.js";

/**
 * Validates whether a value is a valid integer paise representation.
 */
export const isValidPaise = (value, allowNegative = false) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return false;
  }
  return allowNegative ? true : value >= 0;
};

/**
 * Converts rupee amount (number or numeric string) into integer paise.
 * Examples:
 *   1499      -> 149900
 *   1499.50   -> 149950
 *   "1499.5"  -> 149950
 */
export const rupeesToPaise = (rupees, options = { allowNegative: false }) => {
  if (rupees === null || rupees === undefined || rupees === "") {
    throw AppError.validationError("Invalid money input: value cannot be empty");
  }

  if (typeof rupees === "object") {
    throw AppError.validationError("Invalid money input: objects/arrays not allowed");
  }

  const num = Number(rupees);

  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw AppError.validationError("Invalid money input: value must be a finite number");
  }

  if (!options.allowNegative && num < 0) {
    throw AppError.validationError("Invalid money input: negative amounts are not permitted");
  }

  // Use string representation to avoid floating point precision artifacts (e.g. 1499.50 * 100)
  const strVal = String(rupees).trim();
  
  // Validate string pattern (allows optional negative sign if permitted, up to 2 decimal places)
  const regex = options.allowNegative ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/;
  if (!regex.test(strVal) && typeof rupees === "string") {
    throw AppError.validationError("Invalid money format: max 2 decimal places allowed");
  }

  const paise = Math.round(num * 100);

  if (!Number.isSafeInteger(paise)) {
    throw AppError.validationError("Money amount exceeds safe integer limits");
  }

  return paise;
};

/**
 * Converts integer paise to floating rupee value.
 * Example: 149950 -> 1499.5
 */
export const paiseToRupees = (paise) => {
  if (!isValidPaise(paise, true)) {
    throw AppError.validationError("Invalid paise amount: must be a safe integer");
  }
  return paise / 100;
};

/**
 * Formats integer paise to INR currency string.
 * Example: 149900 -> ₹1,499.00
 */
export const formatINR = (paise) => {
  if (!isValidPaise(paise, true)) {
    throw AppError.validationError("Invalid paise amount: must be a safe integer");
  }

  const rupees = paiseToRupees(paise);
  
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(rupees);
};

/**
 * Safely adds two integer paise amounts with overflow protection.
 */
export const safeAddPaise = (a, b) => {
  if (!isValidPaise(a, true) || !isValidPaise(b, true)) {
    throw AppError.validationError("Safe add requires valid integer paise arguments");
  }

  const result = a + b;

  if (!Number.isSafeInteger(result)) {
    throw AppError.validationError("Money addition resulted in integer overflow");
  }

  return result;
};

/**
 * Safely subtracts two integer paise amounts with overflow protection.
 */
export const safeSubtractPaise = (a, b) => {
  if (!isValidPaise(a, true) || !isValidPaise(b, true)) {
    throw AppError.validationError("Safe subtract requires valid integer paise arguments");
  }

  const result = a - b;

  if (!Number.isSafeInteger(result)) {
    throw AppError.validationError("Money subtraction resulted in integer underflow/overflow");
  }

  return result;
};
