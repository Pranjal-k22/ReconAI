import React, { useEffect, useState } from "react";
import { getIntegrationStatus } from "../../api/integrationApi";
import { Badge } from "../common/Badge";

export function IntegrationStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function fetchStatus() {
      try {
        const data = await getIntegrationStatus();
        if (isMounted) setStatus(data);
      } catch (err) {
        // Safe fallback
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    fetchStatus();
    return () => {
      isMounted = false;
    };
  }, []);

  if (loading || !status) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="gray">Checking backend status...</Badge>
      </div>
    );
  }

  const { gemini, razorpay, database } = status;

  return (
    <div className="flex items-center gap-2 text-xs flex-wrap">
      <Badge variant={database?.status === "connected" ? "emerald" : "rose"}>
        DB: {database?.status || "Unknown"}
      </Badge>

      <Badge variant={gemini?.configured ? "emerald" : "amber"}>
        Gemini: {gemini?.mode === "LIVE" ? "Configured" : "Fallback Mode"}
      </Badge>

      <Badge variant={razorpay?.configured ? "indigo" : "gray"}>
        Razorpay: {razorpay?.configured ? "Test Mode" : "Not Configured"}
      </Badge>
    </div>
  );
}
