import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MyClaimsPage } from "../pages/MyClaimsPage.jsx";
import * as casesApi from "../api/casesApi.js";
import { parseInrToPaise } from "../utils/formatMoney.js";

describe("MyClaimsPage Component Invariants", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(casesApi, "fetchMyClaims").mockResolvedValue({
      data: [
        {
          claimId: "clm_existing_001",
          claimType: "DEBIT_NOT_CONFIRMED",
          reference: "ord_demo_123",
          receivedAt: new Date().toISOString(),
          message: "Claim recorded (unverified)"
        }
      ]
    });
  });

  it("renders prominent disclaimer box with exact required wording", async () => {
    render(<MyClaimsPage />);

    await waitFor(() => {
      const disclaimer = screen.getByTestId("claim-disclaimer-box");
      expect(disclaimer).toBeInTheDocument();
      expect(disclaimer.textContent).toContain(
        "Customer statements are unverified evidence. They do not prove debit, cannot move money, and do not alter refund policy eligibility."
      );
    });
  });

  it("updates live 1000-character counter as description is typed", async () => {
    render(<MyClaimsPage />);

    const textarea = screen.getByLabelText(/Description/i);
    const counter = screen.getByTestId("char-counter");
    expect(counter.textContent).toBe("0 / 1000");

    fireEvent.change(textarea, { target: { value: "Hello ReconAI, payment was deducted." } });
    expect(counter.textContent).toBe("36 / 1000");
  });

  it("disables submit button while reference is empty/short and while submission is in-flight", async () => {
    let resolveSubmit;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    vi.spyOn(casesApi, "submitCustomerClaim").mockReturnValue(submitPromise);

    render(<MyClaimsPage />);

    const submitBtn = screen.getByTestId("submit-claim-button");
    // Initially disabled because reference is empty (< 3 chars)
    expect(submitBtn).toBeDisabled();

    // Fill valid reference
    const refInput = screen.getByLabelText(/Transaction \/ Order Reference/i);
    fireEvent.change(refInput, { target: { value: "ord_test_reference" } });
    expect(submitBtn).not.toBeDisabled();

    // Submit form
    fireEvent.click(submitBtn);

    // Button should be disabled during in-flight request
    await waitFor(() => {
      expect(submitBtn).toBeDisabled();
      expect(screen.getByText(/Submitting Claim/i)).toBeInTheDocument();
    });

    // Resolve the submission
    resolveSubmit({
      claimId: "clm_submitted_123",
      receivedAt: new Date().toISOString(),
      status: "RECEIVED"
    });

    // Success banner should appear
    await waitFor(() => {
      expect(screen.getByTestId("claim-success-banner")).toBeInTheDocument();
      expect(screen.getByText(/Claim Recorded \(ID: clm_submitted_123\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Claims do not automatically issue refunds/i)).toBeInTheDocument();
    });
  });

  it("displays user-facing error message on rate limit (429)", async () => {
    vi.spyOn(casesApi, "submitCustomerClaim").mockRejectedValue({
      status: 429,
      type: "RATE_LIMITED",
      message: "Daily claim submission limit reached. Limit: 20 per day."
    });

    render(<MyClaimsPage />);

    const refInput = screen.getByLabelText(/Transaction \/ Order Reference/i);
    fireEvent.change(refInput, { target: { value: "pay_test_rate_limited" } });

    const submitBtn = screen.getByTestId("submit-claim-button");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const errorBanner = screen.getByTestId("claim-error-banner");
      expect(errorBanner).toBeInTheDocument();
      expect(errorBanner.textContent).toContain("Daily claim submission limit reached");
    });
  });

  it("converts claimed INR to paise accurately before submitting", async () => {
    const submitSpy = vi.spyOn(casesApi, "submitCustomerClaim").mockResolvedValue({
      claimId: "clm_paise_test_01",
      receivedAt: new Date().toISOString(),
      status: "RECEIVED"
    });

    render(<MyClaimsPage />);

    const refInput = screen.getByLabelText(/Transaction \/ Order Reference/i);
    fireEvent.change(refInput, { target: { value: "ord_paise_123" } });

    const amountInput = screen.getByLabelText(/Claimed Amount/i);
    fireEvent.change(amountInput, { target: { value: "249.50" } });

    const submitBtn = screen.getByTestId("submit-claim-button");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: "ord_paise_123",
          claimedAmountPaise: 24950
        }),
        expect.any(String)
      );
    });
  });
});

