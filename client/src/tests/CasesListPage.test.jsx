import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CasesListPage } from "../pages/CasesListPage.jsx";
import * as casesApi from "../api/casesApi.js";
import * as AuthContextModule from "../context/AuthContext.jsx";

describe("CasesListPage Client Component Invariants", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      user: { role: "ADMIN", tenantId: null },
      isAuthenticated: true,
      loading: false
    });
  });

  it("renders loading state then displays payment cases with Live API badge", async () => {
    vi.spyOn(casesApi, "fetchPaymentCases").mockResolvedValue({
      data: {
        cases: [
          {
            caseId: "CASE-TEST-001",
            merchantOrderId: "order_test_01",
            gatewayPaymentId: "pay_test_01",
            amountPaise: 10000,
            resolutionCaseStatus: "CASE_DETECTED",
            isSafeHold: false,
            detectedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        pagination: { page: 1, limit: 25, total: 1, pages: 1 }
      }
    });

    render(
      <MemoryRouter>
        <CasesListPage />
      </MemoryRouter>
    );

    // Verify mandatory Live API badge is displayed
    expect(screen.getByText("Live API data")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("CASE-TEST-001")).toBeInTheDocument();
      expect(screen.getByText("₹100.00")).toBeInTheDocument();
      expect(screen.getAllByText("CASE_DETECTED").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders empty state when no cases match", async () => {
    vi.spyOn(casesApi, "fetchPaymentCases").mockResolvedValue({
      data: {
        cases: [],
        pagination: { page: 1, limit: 25, total: 0, pages: 1 }
      }
    });

    render(
      <MemoryRouter>
        <CasesListPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/no payment cases found/i)).toBeInTheDocument();
    });
  });

  it("renders retryable error state on API failure", async () => {
    vi.spyOn(casesApi, "fetchPaymentCases").mockRejectedValue({
      status: 503,
      message: "Service temporarily unavailable. Please retry.",
      retryable: true
    });

    render(
      <MemoryRouter>
        <CasesListPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Service temporarily unavailable/i)).toBeInTheDocument();
      expect(screen.getByText(/Retry request/i)).toBeInTheDocument();
    });
  });

  it("triggers filter update when status or safe-hold filter is modified", async () => {
    const fetchSpy = vi.spyOn(casesApi, "fetchPaymentCases").mockResolvedValue({
      data: { cases: [], pagination: { page: 1, limit: 25, total: 0, pages: 1 } }
    });

    render(
      <MemoryRouter>
        <CasesListPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith({ page: 1, limit: 25 });
    });

    // Check Safe-Hold checkbox
    const safeHoldCheckbox = screen.getByLabelText(/Safe-Hold Only/i);
    fireEvent.click(safeHoldCheckbox);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith({
        page: 1,
        limit: 25,
        isSafeHold: true
      });
    });
  });
});
