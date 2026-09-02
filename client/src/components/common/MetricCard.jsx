import React from "react";
import { Card } from "./Card";

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  color = "slate",
  className = ""
}) {
  const iconColors = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-50 text-emerald-600 border border-emerald-100",
    amber: "bg-amber-50 text-amber-600 border border-amber-100",
    rose: "bg-rose-50 text-rose-600 border border-rose-100",
    indigo: "bg-indigo-50 text-indigo-600 border border-indigo-100",
    blue: "bg-blue-50 text-blue-600 border border-blue-100"
  };

  return (
    <Card className={className} padding="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{title}</p>
          <p className="text-2xl font-bold tracking-tight text-slate-900 mt-1">{value}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
          {trend && (
            <div className="flex items-center gap-1 mt-2 text-xs font-medium text-emerald-600">
              <span>{trend}</span>
            </div>
          )}
        </div>
        {Icon && (
          <div className={`p-2.5 rounded-lg ${iconColors[color] || iconColors.slate}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </Card>
  );
}
