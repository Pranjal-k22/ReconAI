import express from "express";
import crypto from "crypto";
import { z } from "zod";
import { authenticate } from "../middleware/authMiddleware.js";
import {
  CustomerClaim,
  sanitizeClaimDescription,
  computeClaimContentHash,
  CLAIM_TYPES
} from "../models/CustomerClaim.js";
import { MerchantOrder } from "../models/MerchantOrder.js";
import { GatewayPayment } from "../models/GatewayPayment.js";
import { PaymentCase } from "../models/PaymentCase.js";
import { PaymentLifecycleEvent } from "../models/PaymentLifecycleEvent.js";
import { createAuditEvent } from "../services/audit/auditService.js";
import { ROLES } from "../services/auth/tokenService.js";
import { AppError } from "../utils/AppError.js";

const router = express.Router();

// All customer claim endpoints require authentication
router.use(authenticate);

/**
 * Strict Zod request body validation schema for customer claim submission.
 * Explicitly rejects ANY extra, unexpected, or identity-related fields via .strict().
 */
export const createClaimBodySchema = z
  .object({
    claimType: z.enum(CLAIM_TYPES, {
      errorMap: () => ({ message: "claimType must be DEBIT_NOT_CONFIRMED or UNAUTHORIZED_PAYMENT" })
    }),
    reference: z
      .string({ required_error: "reference is required" })
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "reference must be 1..64 characters matching [A-Za-z0-9_-]"),
    claimedAmountPaise: z
      .number({ invalid_type_error: "claimedAmountPaise must be a number" })
      .int("claimedAmountPaise must be an integer")
      .positive("claimedAmountPaise must be a positive integer")
      .max(Number.MAX_SAFE_INTEGER, "claimedAmountPaise exceeds maximum safe integer")
      .optional(),
    description: z
      .string()
      .max(1000, "description cannot exceed 1000 characters")
      .optional()
      .default("")
  })
  .strict();

export const TEMPLATED_CLAIM_MESSAGES = Object.freeze({
  RECEIVED: "Your claim has been received and is being processed by our reconciliation engine. Our team is cross-referencing banking and provider records."
});

// Guardrail rate limits (configurable via env with conservative defaults)
const getHourlyRateLimit = () => parseInt(process.env.CLAIM_RATE_LIMIT_HOURLY, 10) || 5;
const getDailyRateLimit = () => parseInt(process.env.CLAIM_RATE_LIMIT_DAILY, 10) || 20;

/**
 * POST /api/claims
 * Ingests customer claims as unverified evidence.
 * Restricted strictly to CUSTOMER role.
 * Enforces:
 * - Token-only identity (tenantId, customerId from JWT only; zero from body/headers/query)
 * - Required Idempotency-Key header (10..64 chars)
 * - Rate limiting per customer (hourly and daily engineering guardrails)
 * - Audit intent write before any state mutation (fail-closed on audit loss)
 * - Reference lookup strictly within { tenantId, customerId }
 * - Zero existence oracle: identical response shape for LINKED and UNLINKED
 * - Idempotent re-submission (200 on same key + hash; 409 on same key + different content)
 */
router.post("/", async (req, res, next) => {
  try {
    // 1. Role and Token Scoping Barrier
    if (req.user?.role !== ROLES.CUSTOMER) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Customer claim intake is restricted strictly to the CUSTOMER role."
      });
    }

    const { tenantId, customerId } = req.user;
    if (!tenantId || tenantId === "unassigned_provider_quarantine") {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Valid tenant identity is required."
      });
    }
    if (!customerId) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Authenticated token must contain a valid customerId."
      });
    }

    // 2. Idempotency-Key Header Validation
    const rawIdempotencyKey = req.headers["idempotency-key"] || req.headers["Idempotency-Key"];
    if (!rawIdempotencyKey || typeof rawIdempotencyKey !== "string") {
      return res.status(400).json({
        error: "MISSING_IDEMPOTENCY_KEY",
        message: "Idempotency-Key header is required (10..64 alphanumeric/underscore/hyphen characters)."
      });
    }
    const idempotencyKey = rawIdempotencyKey.trim();
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(idempotencyKey)) {
      return res.status(400).json({
        error: "INVALID_IDEMPOTENCY_KEY",
        message: "Idempotency-Key header must be 10..64 characters matching [A-Za-z0-9_-]."
      });
    }

    // 3. Strict Zod Body Validation (rejects any extra or identity fields)
    const parseResult = createClaimBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "INVALID_REQUEST_BODY",
        message: parseResult.error.errors[0]?.message || "Invalid claim payload.",
        details: parseResult.error.errors
      });
    }
    const { claimType, reference, claimedAmountPaise, description } = parseResult.data;

    // 4. Rate Limiting Guardrail per Customer
    const hourlyLimit = getHourlyRateLimit();
    const dailyLimit = getDailyRateLimit();

    const oneHourAgo = new Date(Date.now() - 3600000);
    const hourlyCount = await CustomerClaim.countDocuments({
      tenantId,
      customerId,
      createdAt: { $gte: oneHourAgo }
    });
    if (hourlyCount >= hourlyLimit) {
      return res.status(429).json({
        error: "RATE_LIMIT_EXCEEDED",
        message: `Too many claims submitted in the last hour. Limit: ${hourlyLimit} per hour.`
      });
    }

    const oneDayAgo = new Date(Date.now() - 86400000);
    const dailyCount = await CustomerClaim.countDocuments({
      tenantId,
      customerId,
      createdAt: { $gte: oneDayAgo }
    });
    if (dailyCount >= dailyLimit) {
      return res.status(429).json({
        error: "RATE_LIMIT_EXCEEDED",
        message: `Daily claim submission limit reached. Limit: ${dailyLimit} per day.`
      });
    }

    // 5. Fail-Closed Audit Intent
    try {
      await createAuditEvent({
        actorType: "HUMAN",
        actorId: req.user.userId || customerId,
        action: "CLAIM_SUBMISSION_REQUESTED",
        entityType: "CUSTOMER_CLAIM",
        entityId: idempotencyKey,
        tenantId,
        metadata: {
          customerId,
          claimType,
          reference,
          idempotencyKey
        }
      });
    } catch (auditErr) {
      return res.status(503).json({
        error: "AUDIT_UNAVAILABLE",
        message: "Audit service unavailable; claim submission cannot proceed safely."
      });
    }

    // 6. Sanitization and Deterministic Content Hashing
    const sanitizedDesc = sanitizeClaimDescription(description);
    const referenceValue = reference.trim();
    const referenceType = referenceValue.startsWith("pay_")
      ? "GATEWAY_PAYMENT_ID"
      : referenceValue.startsWith("rrn_")
        ? "BANK_RRN"
        : "MERCHANT_ORDER_ID";

    const contentHash = computeClaimContentHash({
      claimType,
      referenceType,
      referenceValue,
      claimedAmountPaise: claimedAmountPaise || null,
      description: sanitizedDesc
    });

    // 7. Idempotency Check on { tenantId, customerId, idempotencyKey }
    const existingClaim = await CustomerClaim.findOne({
      tenantId,
      customerId,
      idempotencyKey
    });

    if (existingClaim) {
      if (existingClaim.contentHash === contentHash) {
        return res.status(200).json({
          claimId: existingClaim.claimId,
          receivedAt: existingClaim.createdAt.toISOString(),
          status: "RECEIVED"
        });
      }
      // Re-used key with different payload -> 409 Conflict
      await createAuditEvent({
        actorType: "HUMAN",
        actorId: req.user.userId || customerId,
        action: "CLAIM_SUBMISSION_FAILED",
        entityType: "CUSTOMER_CLAIM",
        entityId: existingClaim.claimId,
        tenantId,
        metadata: {
          reason: "IDEMPOTENCY_CONFLICT",
          idempotencyKey
        }
      });
      return res.status(409).json({
        error: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key has already been used with different claim content."
      });
    }

    // 8. Reference Resolution Strictly Within { tenantId, customerId } (No Existence Oracle)
    let linkStatus = "UNLINKED";
    let linkedCaseId = null;
    let resolvedReferenceType = referenceType;

    let matchedOrder = await MerchantOrder.findOne({
      tenantId,
      customerId,
      merchantOrderId: referenceValue
    }).lean();

    let matchedPayment = await GatewayPayment.findOne({
      tenantId,
      customerId,
      $or: [
        { gatewayPaymentId: referenceValue },
        { merchantOrderId: referenceValue }
      ]
    }).lean();

    if (!matchedOrder && matchedPayment?.merchantOrderId) {
      matchedOrder = await MerchantOrder.findOne({
        tenantId,
        customerId,
        merchantOrderId: matchedPayment.merchantOrderId
      }).lean();
    }

    if (!matchedPayment && matchedOrder?.merchantOrderId) {
      matchedPayment = await GatewayPayment.findOne({
        tenantId,
        customerId,
        merchantOrderId: matchedOrder.merchantOrderId
      }).lean();
    }

    if (matchedOrder || matchedPayment) {
      linkStatus = "LINKED";

      // Locate or initialize payment case for the verified order/payment
      let caseDoc = await PaymentCase.findOne({
        tenantId,
        $or: [
          ...(matchedOrder ? [{ merchantOrderId: matchedOrder.merchantOrderId }] : []),
          ...(matchedPayment ? [{ gatewayPaymentId: matchedPayment.gatewayPaymentId }] : [])
        ]
      });

      if (!caseDoc) {
        let initialCaptureStatus = "UNKNOWN";
        if (matchedPayment?.status === "CAPTURED") {
          initialCaptureStatus = "CAPTURE_CAPTURED";
        } else if (matchedPayment?.status === "FAILED") {
          initialCaptureStatus = "CAPTURE_FAILED";
        }

        caseDoc = await PaymentCase.create({
          caseId: `case_${crypto.randomUUID()}`,
          tenantId,
          merchantOrderId: matchedOrder?.merchantOrderId || matchedPayment?.merchantOrderId || referenceValue,
          gatewayPaymentId: matchedPayment?.gatewayPaymentId || null,
          customerId,
          orderStatus: matchedOrder?.orderStatus || "UNKNOWN",
          captureStatus: initialCaptureStatus,
          customerDebitStatus: "DEBIT_REPORTED",
          resolutionCaseStatus: "CASE_DETECTED",
          discrepancyCategory: "STATUS_MISMATCH"
        });
      } else {
        if (!caseDoc.gatewayPaymentId && matchedPayment?.gatewayPaymentId) {
          caseDoc.gatewayPaymentId = matchedPayment.gatewayPaymentId;
        }
        if (
          caseDoc.customerDebitStatus === "UNKNOWN" ||
          caseDoc.customerDebitStatus === "DEBIT_NONE"
        ) {
          caseDoc.customerDebitStatus = "DEBIT_REPORTED";
          await caseDoc.save();
        }
      }

      linkedCaseId = caseDoc.caseId;

      // Append immutable PaymentLifecycleEvent
      await PaymentLifecycleEvent.create({
        eventId: `evt_claim_${crypto.randomUUID()}`,
        tenantId,
        caseId: linkedCaseId,
        sourceSystem: "CUSTOMER_CLAIM",
        normalizedEventType: "CUSTOMER_DEBIT_CLAIM_SUBMITTED",
        deduplicationKey: `claim_evt_${tenantId}_${customerId}_${idempotencyKey}`,
        gatewayPaymentId: matchedPayment?.gatewayPaymentId || null,
        merchantOrderId: matchedOrder?.merchantOrderId || matchedPayment?.merchantOrderId || null,
        currency: "INR",
        payloadFingerprint: contentHash,
        normalizedPayload: {
          claimType,
          reference: referenceValue,
          claimedAmountPaise: claimedAmountPaise || null,
          description: sanitizedDesc
        }
      });
    }

    // 9. Persist CustomerClaim
    const newClaim = await CustomerClaim.create({
      claimId: `clm_${crypto.randomUUID()}`,
      tenantId,
      customerId,
      claimType,
      referenceType: resolvedReferenceType,
      referenceValue,
      claimedAmountPaise: claimedAmountPaise || null,
      description: sanitizedDesc,
      linkedCaseId,
      linkStatus,
      verified: false,
      idempotencyKey,
      contentHash,
      createdAt: new Date()
    });

    // 10. Write Outcome Audit Event
    await createAuditEvent({
      actorType: "HUMAN",
      actorId: req.user.userId || customerId,
      action: "CLAIM_SUBMITTED",
      entityType: "CUSTOMER_CLAIM",
      entityId: newClaim.claimId,
      tenantId,
      metadata: {
        claimId: newClaim.claimId,
        claimType: newClaim.claimType,
        linkStatus: newClaim.linkStatus,
        linkedCaseId: newClaim.linkedCaseId
      }
    });

    // Response: Identical shape for LINKED and UNLINKED
    return res.status(201).json({
      claimId: newClaim.claimId,
      receivedAt: newClaim.createdAt.toISOString(),
      status: "RECEIVED"
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/claims
 * Returns own claims for the authenticated CUSTOMER.
 * Paginated, sanitized, safe templated status message (no internal codes, no classification).
 */
router.get("/", async (req, res, next) => {
  try {
    if (req.user?.role !== ROLES.CUSTOMER) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Claims list is restricted strictly to the CUSTOMER role."
      });
    }

    const { tenantId, customerId } = req.user;
    if (!tenantId || !customerId) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Valid customer credentials required."
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const query = { tenantId, customerId };

    const [claims, total] = await Promise.all([
      CustomerClaim.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CustomerClaim.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: claims.map((c) => ({
        claimId: c.claimId,
        claimType: c.claimType,
        createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
        status: "RECEIVED",
        message: TEMPLATED_CLAIM_MESSAGES.RECEIVED
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/claims/:claimId
 * Returns a single claim by claimId for the authenticated CUSTOMER.
 * Returns 404 if the claim belongs to another customer or tenant.
 */
router.get("/:claimId", async (req, res, next) => {
  try {
    if (req.user?.role !== ROLES.CUSTOMER) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Claim detail is restricted strictly to the CUSTOMER role."
      });
    }

    const { tenantId, customerId } = req.user;
    const { claimId } = req.params;

    const claim = await CustomerClaim.findOne({
      claimId: claimId.trim(),
      tenantId,
      customerId
    }).lean();

    if (!claim) {
      return res.status(404).json({
        error: "CLAIM_NOT_FOUND",
        message: "Claim not found."
      });
    }

    res.status(200).json({
      success: true,
      data: {
        claimId: claim.claimId,
        claimType: claim.claimType,
        createdAt: claim.createdAt ? new Date(claim.createdAt).toISOString() : null,
        status: "RECEIVED",
        message: TEMPLATED_CLAIM_MESSAGES.RECEIVED
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;

