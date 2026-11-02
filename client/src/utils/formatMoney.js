/**
 * ReconAI 2.0 - Paise Currency Formatter
 *
 * Formats integer amounts in paise into INR strings using strict integer arithmetic.
 * Never performs floating point division or conversion on currency amounts.
 *
 * Examples:
 *   0 -> "₹0.00"
 *   1 -> "₹0.01"
 *   10000 -> "₹100.00"
 *   123456789 -> "₹12,34,567.89"
 *   -5000 -> "-₹50.00"
 */

export function formatPaiseToInr(paise) {
  if (paise === null || paise === undefined || Number.isNaN(Number(paise))) {
    return "₹0.00";
  }

  const safeInt = Math.trunc(Number(paise));
  const isNegative = safeInt < 0;
  const abs = Math.abs(safeInt);

  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;
  const paiseStr = remainder < 10 ? `0${remainder}` : `${remainder}`;

  const formattedRupees = rupees.toLocaleString("en-IN");
  return `${isNegative ? "-" : ""}₹${formattedRupees}.${paiseStr}`;
}

/**
 * Parses user INR input string/number cleanly to integer paise.
 * Rejects negative, NaN, non-numeric, and strings with > 10 decimal places.
 * Returns null if input is empty or null/undefined.
 */
export function parseInrToPaise(input) {
  if (input === null || input === undefined || input === "") {
    return null;
  }
  const str = String(input).trim();
  if (str === "") {
    return null;
  }

  // Reject signs (+/-), exponential notation, or non-digits with at most one decimal point
  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new Error("Amount must be a non-negative number");
  }

  const parts = str.split(".");
  if (parts.length === 2 && parts[1].length > 10) {
    throw new Error("Amount cannot exceed 10 decimal places");
  }

  const num = Number(str);
  if (Number.isNaN(num) || num < 0 || !Number.isFinite(num)) {
    throw new Error("Amount must be a non-negative number");
  }

  const rupees = BigInt(parts[0]);
  let paiseFraction = 0n;
  if (parts.length === 2) {
    const dec = parts[1].slice(0, 2).padEnd(2, "0");
    paiseFraction = BigInt(dec);
  }

  const totalPaise = rupees * 100n + paiseFraction;
  if (totalPaise > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount exceeds maximum safe integer");
  }

  return Number(totalPaise);
}

export default formatPaiseToInr;
