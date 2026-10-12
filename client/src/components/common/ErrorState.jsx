import React from "react";
import { AlertTriangle, RefreshCw, KeyRound } from "lucide-react";
import { Button } from "./Button";
import { useAuth } from "../../context/AuthContext";

export function ErrorState({
  title = "Error Loading Data",
  message = "An error occurred while communicating with the ReconAI backend.",
  onRetry
}) {
  const { openLoginModal, login } = useAuth();
  const isAuthError =
    message?.toLowerCase().includes("authentication required") ||
    message?.toLowerCase().includes("missing token") ||
    message?.toLowerCase().includes("unauthorized");

  async function handleQuickDemoConnect() {
    await login("admin@reconai.com", "AdminPassword123!");
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  }

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center bg-rose-50/50 border border-rose-200 rounded-xl my-4">
      <div className="p-3 bg-rose-100 rounded-full text-rose-600 mb-3">
        <AlertTriangle className="w-6 h-6" />
      </div>
      <h4 className="text-sm font-semibold text-rose-900">{title}</h4>
      <p className="text-xs text-rose-700 max-w-md mt-1 mb-4">{message}</p>

      <div className="flex items-center gap-2">
        {isAuthError && (
          <Button size="sm" variant="primary" icon={KeyRound} onClick={handleQuickDemoConnect}>
            Sign In with Admin Account
          </Button>
        )}
        {isAuthError && (
          <Button size="sm" variant="secondary" onClick={openLoginModal}>
            Choose Profile
          </Button>
        )}
        {!isAuthError && onRetry && (
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={onRetry}>
            Retry Connection
          </Button>
        )}
      </div>
    </div>
  );
}
