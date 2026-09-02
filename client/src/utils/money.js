/**
 * Formats an integer paise value into Indian Rupee string (₹).
 * 
 * Rules:
 * - null/undefined/NaN -> "—" (never fake missing values as ₹0)
 * - Uses Indian currency locale formatting (en-IN).
 * 
 * @param {number|null|undefined} paise 
 * @returns {string} Formatted INR currency string or "—"
 */
export function formatINRFromPaise(paise) {
  if (paise === null || paise === undefined || typeof paise !== "number" || isNaN(paise)) {
    return "—";
  }

  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(rupees);
}

/**
 * Formats a decimal percentage (0.6667 -> "66.67%")
 * @param {number|null|undefined} val 
 * @returns {string}
 */
export function formatPercent(val) {
  if (val === null || val === undefined || typeof val !== "number" || isNaN(val)) {
    return "—";
  }
  return `${(val * 100).toFixed(2)}%`;
}
