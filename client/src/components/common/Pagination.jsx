import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./Button";

export function Pagination({ pagination, onPageChange }) {
  if (!pagination) return null;

  const { page = 1, limit = 10, totalRecords = 0, totalPages = 1 } = pagination;

  const startRecord = totalRecords === 0 ? 0 : (page - 1) * limit + 1;
  const endRecord = Math.min(page * limit, totalRecords);

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-slate-200 sm:px-6">
      <div className="text-xs text-slate-600">
        Showing <span className="font-medium text-slate-900">{startRecord}</span> to{" "}
        <span className="font-medium text-slate-900">{endRecord}</span> of{" "}
        <span className="font-medium text-slate-900">{totalRecords}</span> results
      </div>
      <div className="flex items-center space-x-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          icon={ChevronLeft}
        >
          Previous
        </Button>
        <span className="text-xs font-medium text-slate-700 px-2">
          Page {page} of {totalPages || 1}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <span>Next</span>
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
