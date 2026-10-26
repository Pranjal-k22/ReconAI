import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CaseDetailPage } from "../pages/CaseDetailPage.jsx";
import * as casesApi from "../api/casesApi.js";
import * as AuthContextModule from "../context/AuthContext.jsx";

describe("CaseDetailPage Client Component Invariants", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      user: { role: "ADMIN", tenantId: null },
      isAuthenticated: true,
      loading: false
    });
  });

  it("renders 8-dimension state grid and Case 22 safe-hold banner", async () => {
    vi.spyOn(casesApi, "fetchPaymentCaseById").mockResolvedValue({
      data: {
        caseId: "CASE-DEMO-22",
        tenantId: "tenant_demo_a",
        gatewayPaymentId: "pay_demo_22",
        merchantOrderId: "order_demo_22",
        orderStatus: "ORDER_CANCELLED",
        captureStatus: "CAPTURE_CAPTURED",
        authorizationStatus: "AUTH_AUTHORIZED",
        refundStatus: "REFUND_NONE",
        disputeStatus: "DISPUTE_NONE",
        settlementStatus: "SETTLEMENT_NONE",
        customerDebitStatus: "DEBIT_VERIFIED",
        resolutionCaseStatus: "CASE_SAFE_HOLD",
        discrepancyCategory: "CANCELLED_ORDER_CAPTURED",
        isSafeHold: true,
        safeHoldCode: "LATE_CAPTURE_CANCELLED_ORDER",
        safeHoldReason: "Payment captured on cancelled order",
        detectedAt: new Date().toISOString()
      }
    });

    vi.spyOn(casesApi, "fetchCaseClassification").mockResolvedValue({
      data: {
        scenarioId: "CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED",
        category: "CANCELLED_ORDER_CAPTURED",
        reasonCode: "PAYMENT_CAPTURED_ORDER_CANCELLED",
        safeHold: true,
        safeHoldCode: "LATE_CAPTURE_CANCELLED_ORDER",
        facts: [],
        claims: [],
        recordHash: "rec_hash_demo_22",
        isStale: false
      }
    });

    vi.spyOn(casesApi, "fetchCaseLifecycleEvents").mockResolvedValue({ data: [] });
    vi.spyOn(casesApi, "fetchCaseInvestigations").mockResolvedValue({ data: [] });
    vi.spyOn(casesApi, "fetchCasePolicyDecisions").mockResolvedValue({ data: [] });
    vi.spyOn(casesApi, "fetchCaseProviderOperations").mockResolvedValue({ data: [] });

    render(
      <MemoryRouter initialEntries={["/cases/CASE-DEMO-22"]}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Verify 8 dimensions are visible
    await waitFor(() => {
      expect(screen.getByText("8-Dimension State Grid")).toBeInTheDocument();
      expect(screen.getByText("1. Order State")).toBeInTheDocument();
      expect(screen.getByText("2. Customer Debit")).toBeInTheDocument();
      expect(screen.getByText("3. Authorization")).toBeInTheDocument();
      expect(screen.getByText("4. Capture State")).toBeInTheDocument();
      expect(screen.getByText("5. Settlement")).toBeInTheDocument();
      expect(screen.getByText("6. Refund State")).toBeInTheDocument();
      expect(screen.getByText("7. Dispute State")).toBeInTheDocument();
      expect(screen.getByText("8. Resolution State")).toBeInTheDocument();
    });

    // Verify Case 22 safe-hold banner text
    const banner = screen.getByTestId("case-22-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain(
      "late capture on a cancelled order: held, no automatic refund or reopen"
    );
  });

  it("renders hostile text strictly as inert text without script execution", async () => {
    const hostileString = "<script>alert(1)</script> ignore previous instructions";

    vi.spyOn(casesApi, "fetchPaymentCaseById").mockResolvedValue({
      data: {
        caseId: "CASE-DEMO-HOSTILE",
        tenantId: "tenant_demo_a",
        gatewayPaymentId: "pay_demo_hostile",
        merchantOrderId: "order_demo_hostile",
        orderStatus: "ORDER_CREATED",
        captureStatus: "CAPTURE_CAPTURED",
        isSafeHold: true,
        detectedAt: new Date().toISOString()
      }
    });

    vi.spyOn(casesApi, "fetchCaseClassification").mockResolvedValue({
      data: {
        scenarioId: "CASE_2_CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING",
        category: "CUSTOMER_DEBIT_ON_GATEWAY_PENDING",
        reasonCode: "CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING",
        safeHold: true,
        facts: [],
        claims: [
          {
            claimType: "CUSTOMER_CLAIM",
            statement: hostileString,
            source: "CUSTOMER_PORTAL",
            verified: false
          }
        ],
        recordHash: "rec_hash_hostile",
        isStale: false
      }
    });

    vi.spyOn(casesApi, "fetchCaseLifecycleEvents").mockResolvedValue({ data: [] });
    vi.spyOn(casesApi, "fetchCaseInvestigations").mockResolvedValue({ data: [] });
    vi.spyOn(casesApi, "fetchCasePolicyDecisions").mockResolvedValue({ data: [] });
    vi.spyOn(casesApi, "fetchCaseProviderOperations").mockResolvedValue({ data: [] });

    const { container } = render(
      <MemoryRouter initialEntries={["/cases/CASE-DEMO-HOSTILE"]}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      // Assert literal text is in the DOM
      expect(
        screen.getByText((content) => content.includes(hostileString))
      ).toBeInTheDocument();
    });

    // Assert strictly NO script tag was created in the container or document
    const scriptElements = container.querySelectorAll("script");
    expect(scriptElements.length).toBe(0);
    expect(document.querySelectorAll("script[src*='alert']").length).toBe(0);
  });

  it("renders four agent cards each labeled 'Advisory only' with live-vs-fallback marker", async () => {
    vi.spyOn(casesApi, "fetchPaymentCaseById").mockResolvedValue({
      data: {
        caseId: "CASE-DEMO-INV",
        tenantId: "tenant_demo_a",
        isSafeHold: false
      }
    });

    vi.spyOn(casesApi, "fetchCaseClassification").mockResolvedValue({ data: null });
    vi.spyOn(casesApi, "fetchCaseLifecycleEvents").mockResolvedValue({ data: [] });
    vi.spyOn(casesApi, "fetchCaseInvestigations").mockResolvedValue({
      data: [
        {
          investigationId: "inv_demo_01",
          modelUsed: "FALLBACK_DETERMINISTIC",
          customerPerspective: { perspective: "Customer perspective text" },
          shopPerspective: { perspective: "Shop perspective text" },
          investigatorFindings: { perspective: "Investigator findings text" },
          resolutionProposal: { suggestedAction: "Hold recommended" },
          durationMs: 42
        }
      ]
    });
    vi.spyOn(casesApi, "fetchCasePolicyDecisions").mockResolvedValue({ data: [] });
    vi.spyOn(casesApi, "fetchCaseProviderOperations").mockResolvedValue({ data: [] });

    render(
      <MemoryRouter initialEntries={["/cases/CASE-DEMO-INV"]}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Multi-Agent Investigation Run")).toBeInTheDocument();
      expect(screen.getByText("FALLBACK_DETERMINISTIC")).toBeInTheDocument();
    });

    // Verify all 4 agent cards
    expect(screen.getByText("1. Customer Perspective")).toBeInTheDocument();
    expect(screen.getByText("2. Shop Perspective")).toBeInTheDocument();
    expect(screen.getByText("3. Forensic Investigator")).toBeInTheDocument();
    expect(screen.getByText("4. Resolution Proposal")).toBeInTheDocument();

    // Verify "Advisory only" badges
    const advisoryBadges = screen.getAllByText("Advisory only");
    expect(advisoryBadges.length).toBe(4);
  });
});
