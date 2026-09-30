import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ToastProvider } from "./components/common/ToastContext";
import { AppLayout } from "./components/layout/AppLayout";

import DashboardPage from "./pages/DashboardPage";
import FinanceControllerPage from "./pages/FinanceControllerPage";
import ReconciliationRunsPage from "./pages/ReconciliationRunsPage";
import ReconciliationDetailPage from "./pages/ReconciliationDetailPage";
import ExceptionsPage from "./pages/ExceptionsPage";
import ExceptionDetailPage from "./pages/ExceptionDetailPage";
import AuditTrailPage from "./pages/AuditTrailPage";
import ImportDataPage from "./pages/ImportDataPage";
import RazorpaySyncPage from "./pages/RazorpaySyncPage";
import EvaluationPage from "./pages/EvaluationPage";
import NotFoundPage from "./pages/NotFoundPage";

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="finance-controller" element={<FinanceControllerPage />} />
            <Route path="runs" element={<ReconciliationRunsPage />} />
            <Route path="runs/:runId" element={<ReconciliationDetailPage />} />
            <Route path="exceptions" element={<ExceptionsPage />} />
            <Route path="exceptions/:exceptionId" element={<ExceptionDetailPage />} />
            <Route path="audit" element={<AuditTrailPage />} />
            <Route path="import" element={<ImportDataPage />} />
            <Route path="razorpay" element={<RazorpaySyncPage />} />
            <Route path="evaluation" element={<EvaluationPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
