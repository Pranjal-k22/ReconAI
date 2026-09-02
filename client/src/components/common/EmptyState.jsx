import React from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "./Button";

export function EmptyState({
  title = "No data found",
  description = "There are no records to display at this time.",
  icon: Icon = FolderOpen,
  actionLabel,
  onAction
}) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center bg-white border border-slate-200 rounded-xl my-4">
      <div className="p-3 bg-slate-100 rounded-full text-slate-500 mb-3">
        <Icon className="w-6 h-6" />
      </div>
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      <p className="text-xs text-slate-500 max-w-sm mt-1 mb-4">{description}</p>
      {actionLabel && onAction && (
        <Button size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
