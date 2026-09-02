import React from "react";

export function Card({ children, className = "", header, footer, padding = "p-5" }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden ${className}`}>
      {header && (
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          {typeof header === "string" ? (
            <h3 className="text-sm font-semibold text-slate-800">{header}</h3>
          ) : (
            header
          )}
        </div>
      )}
      <div className={padding}>{children}</div>
      {footer && (
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-500">
          {footer}
        </div>
      )}
    </div>
  );
}
