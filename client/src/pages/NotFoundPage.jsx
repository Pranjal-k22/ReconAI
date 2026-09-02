import React from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Home } from "lucide-react";
import { Button } from "../components/common/Button";

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
      <div className="p-4 bg-slate-100 rounded-full text-slate-500 mb-4">
        <AlertCircle className="w-10 h-10" />
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">404 — Page Not Found</h1>
      <p className="text-sm text-slate-500 max-w-sm mt-2 mb-6">
        The requested route does not exist in the ReconAI console navigation.
      </p>
      <Button variant="primary" icon={Home} onClick={() => navigate("/")}>
        Return to Dashboard
      </Button>
    </div>
  );
}
