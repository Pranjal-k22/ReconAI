import React from "react";
import { useAuth } from "../../context/AuthContext";
import { ShieldAlert } from "lucide-react";

export const WORKSPACE_ALLOWED_ROLES = ["ADMIN", "SHOP", "AUDITOR"];

export function RoleGuard({ children, allowedRoles = WORKSPACE_ALLOWED_ROLES }) {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-slate-400 text-sm">Authenticating session...</div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center">
        <ShieldAlert className="w-12 h-12 text-amber-500 mb-3" />
        <h2 className="text-lg font-semibold text-slate-800">Authentication Required</h2>
        <p className="text-sm text-slate-500 mt-1 max-w-md">
          Please log in with an authorized account to access the operator workspace.
        </p>
      </div>
    );
  }

  const role = user.role?.toUpperCase();
  if (!allowedRoles.includes(role)) {
    return (
      <div
        data-testid="role-guard-unauthorized"
        className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center bg-white rounded-xl border border-slate-200 shadow-xs"
      >
        <div className="p-3 bg-red-50 text-red-600 rounded-full mb-3">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-base font-semibold text-slate-900">Access Restricted</h2>
        <p className="text-sm text-slate-600 mt-1 font-medium">
          not available for your role
        </p>
        <p className="text-xs text-slate-400 mt-2">
          Current role: <span className="font-mono font-semibold">{user.role || "UNKNOWN"}</span>. Workspace access is limited to ADMIN, SHOP, and AUDITOR.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

export default RoleGuard;
