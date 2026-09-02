import React from "react";
import { Loader2 } from "lucide-react";

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon: Icon,
  className = "",
  onClick,
  type = "button",
  ...props
}) {
  const baseStyles =
    "inline-flex items-center justify-center font-medium transition-colors rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none";

  const variants = {
    primary: "bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950 shadow-xs",
    secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 active:bg-slate-100 shadow-xs",
    outline: "bg-transparent border border-slate-300 text-slate-700 hover:bg-slate-50",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100 text-slate-800",
    danger: "bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-xs",
    emerald: "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-xs"
  };

  const sizes = {
    sm: "px-2.5 py-1.5 text-xs gap-1.5",
    md: "px-3.5 py-2 text-sm gap-2",
    lg: "px-4 py-2.5 text-base gap-2.5"
  };

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`${baseStyles} ${variants[variant] || variants.primary} ${sizes[size] || sizes.md} ${className}`}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
      ) : Icon ? (
        <Icon className="w-4 h-4 flex-shrink-0" />
      ) : null}
      <span>{children}</span>
    </button>
  );
}
