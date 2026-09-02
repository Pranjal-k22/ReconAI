/**
 * Converts machine enum values to human readable titles.
 * Example: "COMPLETED_WITH_EXCEPTIONS" -> "Completed with exceptions"
 */
export function formatEnumLabel(enumStr) {
  if (!enumStr || typeof enumStr !== "string") return "—";

  const labels = {
    // Classifications
    MATCHED: "Matched",
    AMOUNT_MISMATCH: "Amount Mismatch",
    MISSING_SETTLEMENT: "Missing Settlement",
    DUPLICATE_PAYMENT: "Duplicate Payment",
    DUPLICATE_SETTLEMENT: "Duplicate Settlement",
    FEE_MISMATCH: "Fee Mismatch",
    REFUND_MISMATCH: "Refund Mismatch",
    MISSING_PAYMENT: "Missing Payment",
    REFERENCE_MISMATCH: "Reference Mismatch",
    STATUS_MISMATCH: "Status Mismatch",
    AMBIGUOUS: "Ambiguous Match",
    INVALID_DATA: "Invalid Data",

    // Run status
    PENDING: "Pending",
    RUNNING: "Running",
    COMPLETED: "Completed",
    COMPLETED_WITH_EXCEPTIONS: "Completed with Exceptions",
    FAILED: "Failed",

    // Resolution / Status
    OPEN: "Open",
    UNDER_REVIEW: "Under Review",
    RESOLVED: "Resolved",
    DISMISSED: "Dismissed",
    AUTO_RECONCILED: "Auto Reconciled",
    APPROVED: "Approved",
    NEEDS_HUMAN_REVIEW: "Needs Human Review",

    // Decisions
    KEEP_EXCEPTION: "Keep Exception",
    APPROVE_MATCH: "Approve Match",
    MARK_RESOLVED: "Mark Resolved",

    // Severity
    LOW: "Low",
    MEDIUM: "Medium",
    HIGH: "High",
    CRITICAL: "Critical",

    // Actions
    RECONCILIATION_STARTED: "Reconciliation Started",
    MATCH_CREATED: "Match Created",
    EXCEPTION_CREATED: "Exception Created",
    RECONCILIATION_COMPLETED: "Reconciliation Completed",
    AI_INVESTIGATION_REQUESTED: "AI Investigation Requested",
    AI_INVESTIGATION_COMPLETED: "AI Investigation Completed",
    AI_INVESTIGATION_FAILED: "AI Investigation Failed",
    HUMAN_DECISION: "Human Decision Applied",
    RAZORPAY_SYNC_STARTED: "Razorpay Sync Started",
    RAZORPAY_SYNC_COMPLETED: "Razorpay Sync Completed",
    RAZORPAY_SYNC_FAILED: "Razorpay Sync Failed"
  };

  if (labels[enumStr]) return labels[enumStr];

  return enumStr
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
