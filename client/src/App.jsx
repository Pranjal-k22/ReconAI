import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./components/common/ToastContext";
import { AuthProvider } from "./context/AuthContext";
import { AppLayout } from "./components/layout/AppLayout";

import LandingPage from "./pages/LandingPage";
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
import CasesListPage from "./pages/CasesListPage";
import CaseDetailPage from "./pages/CaseDetailPage";
import NotFoundPage from "./pages/NotFoundPage";

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              {/* Flagship ReconAI 2.0 Spatial AI Landing Page */}
              <Route path="/" element={<LandingPage />} />

              {/* Internal Finance Controller & Operations App */}
              <Route path="/app" element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="cases" element={<CasesListPage />} />
                <Route path="cases/:caseId" element={<CaseDetailPage />} />
                <Route path="finance-controller" element={<FinanceControllerPage />} />
                <Route path="runs" element={<ReconciliationRunsPage />} />
                <Route path="runs/:runId" element={<ReconciliationDetailPage />} />
                <Route path="exceptions" element={<ExceptionsPage />} />
                <Route path="exceptions/:exceptionId" element={<ExceptionDetailPage />} />
                <Route path="audit" element={<AuditTrailPage />} />
                <Route path="import" element={<ImportDataPage />} />
                <Route path="razorpay" element={<RazorpaySyncPage />} />
                <Route path="evaluation" element={<EvaluationPage />} />
              </Route>

              {/* Direct convenience routes for existing bookmarks */}
              <Route element={<AppLayout />}>
                <Route path="/cases" element={<CasesListPage />} />
                <Route path="/cases/:caseId" element={<CaseDetailPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/finance-controller" element={<FinanceControllerPage />} />
                <Route path="/runs" element={<ReconciliationRunsPage />} />
                <Route path="/runs/:runId" element={<ReconciliationDetailPage />} />
                <Route path="/exceptions" element={<ExceptionsPage />} />
                <Route path="/exceptions/:exceptionId" element={<ExceptionDetailPage />} />
                <Route path="/audit" element={<AuditTrailPage />} />
                <Route path="/import" element={<ImportDataPage />} />
                <Route path="/razorpay" element={<RazorpaySyncPage />} />
                <Route path="/evaluation" element={<EvaluationPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
