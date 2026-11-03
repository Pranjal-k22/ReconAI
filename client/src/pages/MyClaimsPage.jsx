import React, { useState, useEffect, useCallback } from "react";
import { submitCustomerClaim, fetchMyClaims } from "../api/claimsApi";
import { parseInrToPaise } from "../utils/formatMoney";
import { ShieldAlert, CheckCircle2, AlertCircle, FileText, Send, Clock } from "lucide-react";

export function MyClaimsPage() {
  const [claimType, setClaimType] = useState("DEBIT_NOT_CONFIRMED");
  const [reference, setReference] = useState("");
  const [claimedAmountInr, setClaimedAmountInr] = useState("");
  const [description, setDescription] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successData, setSuccessData] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const [claimsList, setClaimsList] = useState([]);
  const [loadingClaims, setLoadingClaims] = useState(true);
  const [claimsError, setClaimsError] = useState(null);

  const loadMyClaims = useCallback(async () => {
    setLoadingClaims(true);
    setClaimsError(null);
    try {
      const res = await fetchMyClaims();
      setClaimsList(res?.data || []);
    } catch (err) {
      setClaimsError(err.message || "Unable to load previous claims.");
    } finally {
      setLoadingClaims(false);
    }
  }, []);

  useEffect(() => {
    loadMyClaims();
  }, [loadMyClaims]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSuccessData(null);
    setErrorMessage(null);

    const trimmedRef = reference.trim();
    if (!trimmedRef || trimmedRef.length < 3 || trimmedRef.length > 128) {
      setErrorMessage("Reference is required and must be between 3 and 128 characters.");
      return;
    }

    let parsedPaise = null;
    if (claimedAmountInr && claimedAmountInr.trim() !== "") {
      try {
        parsedPaise = parseInrToPaise(claimedAmountInr);
      } catch (parseErr) {
        setErrorMessage(parseErr.message || "Invalid amount format.");
        return;
      }
    }

    if (description.length > 1000) {
      setErrorMessage("Description cannot exceed 1000 characters.");
      return;
    }

    setIsSubmitting(true);

    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `idem_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;

      const payload = {
        claimType,
        reference: trimmedRef
      };
      if (parsedPaise !== null) {
        payload.claimedAmountPaise = parsedPaise;
      }
      if (description.trim()) {
        payload.description = description.trim();
      }

      const res = await submitCustomerClaim(payload, idempotencyKey);

      setSuccessData({
        claimId: res.claimId,
        message:
          "Your claim has been recorded. Our automated systems and operations teams will cross-check provider records. Claims do not automatically issue refunds."
      });

      // Reset form
      setReference("");
      setClaimedAmountInr("");
      setDescription("");

      // Refresh list
      loadMyClaims();
    } catch (err) {
      setErrorMessage(err.message || "An unexpected error occurred while submitting your claim.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-6 h-6 text-indigo-600" />
          My Payment Claims
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Submit claims regarding bank debits or unauthorized transactions. Claims are tracked as unverified customer statements.
        </p>
      </div>

      {/* Prominent Disclaimer Box */}
      <div
        data-testid="claim-disclaimer-box"
        className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-md text-amber-800 text-xs sm:text-sm flex items-start gap-3"
      >
        <ShieldAlert className="w-5 h-5 flex-shrink-0 text-amber-600 mt-0.5" />
        <div>
          <span className="font-semibold">Notice: </span>
          Customer statements are unverified evidence. They do not prove debit, cannot move money, and do not alter refund policy eligibility.
        </div>
      </div>

      {/* Success Banner */}
      {successData && (
        <div
          data-testid="claim-success-banner"
          className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-lg flex items-start gap-3"
        >
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-sm">
              Claim Recorded (ID: {successData.claimId})
            </div>
            <p className="text-xs sm:text-sm text-green-700 mt-1">{successData.message}</p>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div
          data-testid="claim-error-banner"
          className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">{errorMessage}</div>
        </div>
      )}

      {/* Submission Form */}
      <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Submit a Claim</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="claimType" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              Claim Type
            </label>
            <select
              id="claimType"
              value={claimType}
              onChange={(e) => setClaimType(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="DEBIT_NOT_CONFIRMED">Debit Not Confirmed (Money deducted but pending or failed)</option>
              <option value="UNAUTHORIZED_PAYMENT">Unauthorized Payment (Suspicious or unrecognized transaction)</option>
            </select>
          </div>

          <div>
            <label htmlFor="reference" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              Transaction / Order Reference *
            </label>
            <input
              id="reference"
              type="text"
              required
              minLength={3}
              maxLength={128}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. ord_order12345 or pay_gatewayPaymentId"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-400 mt-1">Order ID or Gateway Payment ID (3 to 128 characters)</p>
          </div>

          <div>
            <label htmlFor="claimedAmountInr" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              Claimed Amount (₹ INR, Optional)
            </label>
            <input
              id="claimedAmountInr"
              type="text"
              value={claimedAmountInr}
              onChange={(e) => setClaimedAmountInr(e.target.value)}
              placeholder="e.g. 250.00"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label htmlFor="description" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Description (Optional)
              </label>
              <span
                data-testid="char-counter"
                className={`text-xs ${description.length > 1000 ? "text-red-500 font-bold" : "text-gray-400"}`}
              >
                {description.length} / 1000
              </span>
            </div>
            <textarea
              id="description"
              rows={3}
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide any relevant details about what you observed..."
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || reference.trim().length < 3}
            data-testid="submit-claim-button"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-indigo-600 text-white font-medium text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isSubmitting ? (
              <>
                <Clock className="w-4 h-4 animate-spin" />
                Submitting Claim...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Submit Claim
              </>
            )}
          </button>
        </form>
      </div>

      {/* Previous Claims Table */}
      <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">My Submitted Claims</h2>

        {loadingClaims ? (
          <div className="py-8 text-center text-sm text-gray-400">Loading your claims...</div>
        ) : claimsError ? (
          <div className="text-sm text-red-600 py-4">{claimsError}</div>
        ) : claimsList.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">No claims submitted yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Received At</th>
                  <th className="px-4 py-3 font-medium">Claim Type</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium">Status / Notice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {claimsList.map((c) => (
                  <tr key={c.claimId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                      {c.receivedAt ? new Date(c.receivedAt).toLocaleString("en-IN") : "-"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                        {c.claimType}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-gray-700">
                      {c.reference}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {c.message || "Claim recorded (unverified)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default MyClaimsPage;

