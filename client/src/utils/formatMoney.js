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

export default formatPaiseToInr;
