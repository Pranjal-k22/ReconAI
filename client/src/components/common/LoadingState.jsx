import React from "react";
import { Loader2 } from "lucide-react";

export function LoadingState({ message = "Loading data..." }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center my-4">
      <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-3" />
      <p className="text-sm font-medium text-slate-600">{message}</p>
    </div>
  );
}

export function SkeletonRow({ cols = 5 }) {
  return (
    <tr className="animate-pulse border-b border-slate-100">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 bg-slate-200 rounded w-full max-w-[120px]"></div>
        </td>
      ))}
    </tr>
  );
}
