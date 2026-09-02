import React from "react";
import { formatEnumLabel } from "../../utils/enum";

export function Badge({ children, variant = "default", className = "" }) {
  const variants = {
    default: "bg-slate-100 text-slate-700 border-slate-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
    gray: "bg-slate-100 text-slate-600 border-slate-200"
  };

  const style = variants[variant] || variants.default;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium border ${style} ${className}`}
    >
      {children}
    </span>
  );
}

export function ClassificationBadge({ classification }) {
  const variantMap = {
    MATCHED: "emerald",
    AMOUNT_MISMATCH: "rose",
    MISSING_SETTLEMENT: "amber",
    DUPLICATE_PAYMENT: "rose",
    DUPLICATE_SETTLEMENT: "rose",
    FEE_MISMATCH: "amber",
    REFUND_MISMATCH: "rose",
    MISSING_PAYMENT: "rose",
    REFERENCE_MISMATCH: "amber",
    STATUS_MISMATCH: "amber",
    AMBIGUOUS: "violet",
    INVALID_DATA: "gray"
  };

  const variant = variantMap[classification] || "default";

  return <Badge variant={variant}>{formatEnumLabel(classification)}</Badge>;
}

export function SeverityBadge({ severity }) {
  const variantMap = {
    LOW: "blue",
    MEDIUM: "amber",
    HIGH: "rose",
    CRITICAL: "rose"
  };

  const variant = variantMap[severity] || "default";

  return <Badge variant={variant}>{formatEnumLabel(severity)}</Badge>;
}

export function StatusBadge({ status }) {
  const variantMap = {
    OPEN: "rose",
    UNDER_REVIEW: "amber",
    RESOLVED: "emerald",
    DISMISSED: "gray",
    COMPLETED: "emerald",
    COMPLETED_WITH_EXCEPTIONS: "amber",
    FAILED: "rose",
    PENDING: "blue",
    RUNNING: "indigo",
    AUTO_RECONCILED: "emerald"
  };

  const variant = variantMap[status] || "default";

  return <Badge variant={variant}>{formatEnumLabel(status)}</Badge>;
}
