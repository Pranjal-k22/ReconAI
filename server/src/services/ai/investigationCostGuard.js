import { InvestigationRateLimit } from "../../models/InvestigationRateLimit.js";
import { AppError } from "../../utils/AppError.js";

/**
 * ReconAI 2.0 - Investigation Cost Guard Service
 *
 * Prevents runaway LLM API costs by enforcing conservative, MongoDB-persisted
 * rate limits and daily caps per administrator and per tenant.
 *
 * State lives strictly in MongoDB ('investigationratelimits' collection with TTL indexing),
 * persisting across server restarts and multiple process instances.
 */

export const getAdminHourlyLimit = () =>
  parseInt(process.env.INVESTIGATION_LIMIT_ADMIN_HOURLY, 10) || 10;

export const getAdminDailyLimit = () =>
  parseInt(process.env.INVESTIGATION_LIMIT_ADMIN_DAILY, 10) || 50;

export const getTenantHourlyLimit = () =>
  parseInt(process.env.INVESTIGATION_LIMIT_TENANT_HOURLY, 10) || 30;

export const getTenantDailyLimit = () =>
  parseInt(process.env.INVESTIGATION_LIMIT_TENANT_DAILY, 10) || 150;

/**
 * Checks whether the proposed investigation call exceeds admin or tenant limits.
 * Throws AppError(429) if any limit is reached.
 *
 * @param {Object} params
 * @param {string} params.adminId
 * @param {string} params.tenantId
 * @param {number} [params.nowMs=Date.now()]
 */
export async function checkInvestigationCostGuard({ adminId, tenantId, nowMs = Date.now() }) {
  const cleanAdminId = String(adminId || "unknown_admin").trim();
  const cleanTenantId = String(tenantId || "unknown_tenant").trim();

  const adminHourlyLimit = getAdminHourlyLimit();
  const adminDailyLimit = getAdminDailyLimit();
  const tenantHourlyLimit = getTenantHourlyLimit();
  const tenantDailyLimit = getTenantDailyLimit();

  const hourBucket = Math.floor(nowMs / 3600000);
  const dayBucket = Math.floor(nowMs / 86400000);

  const adminHourKey = `admin_hourly:${cleanAdminId}:${hourBucket}`;
  const adminDayKey = `admin_daily:${cleanAdminId}:${dayBucket}`;
  const tenantHourKey = `tenant_hourly:${cleanTenantId}:${hourBucket}`;
  const tenantDayKey = `tenant_daily:${cleanTenantId}:${dayBucket}`;

  // Query existing counters in parallel
  const [adminHourDoc, adminDayDoc, tenantHourDoc, tenantDayDoc] = await Promise.all([
    InvestigationRateLimit.findOne({ key: adminHourKey }).lean(),
    InvestigationRateLimit.findOne({ key: adminDayKey }).lean(),
    InvestigationRateLimit.findOne({ key: tenantHourKey }).lean(),
    InvestigationRateLimit.findOne({ key: tenantDayKey }).lean()
  ]);

  if ((adminHourDoc?.count || 0) >= adminHourlyLimit) {
    throw new AppError(
      `Investigation cost guard exceeded: Admin hourly limit of ${adminHourlyLimit} reached. Please wait before running further investigations.`,
      429,
      "RATE_LIMIT_EXCEEDED"
    );
  }

  if ((adminDayDoc?.count || 0) >= adminDailyLimit) {
    throw new AppError(
      `Investigation cost guard exceeded: Admin daily cap of ${adminDailyLimit} reached. Please wait before running further investigations.`,
      429,
      "RATE_LIMIT_EXCEEDED"
    );
  }

  if ((tenantHourDoc?.count || 0) >= tenantHourlyLimit) {
    throw new AppError(
      `Investigation cost guard exceeded: Tenant hourly limit of ${tenantHourlyLimit} reached. Please wait before running further investigations.`,
      429,
      "RATE_LIMIT_EXCEEDED"
    );
  }

  if ((tenantDayDoc?.count || 0) >= tenantDailyLimit) {
    throw new AppError(
      `Investigation cost guard exceeded: Tenant daily cap of ${tenantDailyLimit} reached. Please wait before running further investigations.`,
      429,
      "RATE_LIMIT_EXCEEDED"
    );
  }
}

/**
 * Atomically increments the cost guard counters in MongoDB.
 *
 * @param {Object} params
 * @param {string} params.adminId
 * @param {string} params.tenantId
 * @param {number} [params.nowMs=Date.now()]
 */
export async function recordInvestigationCostUsage({ adminId, tenantId, nowMs = Date.now() }) {
  const cleanAdminId = String(adminId || "unknown_admin").trim();
  const cleanTenantId = String(tenantId || "unknown_tenant").trim();

  const hourBucket = Math.floor(nowMs / 3600000);
  const dayBucket = Math.floor(nowMs / 86400000);

  // TTL expires after 2 hours for hourly, 2 days for daily
  const hourExpiresAt = new Date((hourBucket + 2) * 3600000);
  const dayExpiresAt = new Date((dayBucket + 2) * 86400000);

  const updates = [
    {
      key: `admin_hourly:${cleanAdminId}:${hourBucket}`,
      scope: "ADMIN_HOURLY",
      adminId: cleanAdminId,
      tenantId: null,
      expiresAt: hourExpiresAt
    },
    {
      key: `admin_daily:${cleanAdminId}:${dayBucket}`,
      scope: "ADMIN_DAILY",
      adminId: cleanAdminId,
      tenantId: null,
      expiresAt: dayExpiresAt
    },
    {
      key: `tenant_hourly:${cleanTenantId}:${hourBucket}`,
      scope: "TENANT_HOURLY",
      adminId: null,
      tenantId: cleanTenantId,
      expiresAt: hourExpiresAt
    },
    {
      key: `tenant_daily:${cleanTenantId}:${dayBucket}`,
      scope: "TENANT_DAILY",
      adminId: null,
      tenantId: cleanTenantId,
      expiresAt: dayExpiresAt
    }
  ];

  await Promise.all(
    updates.map((u) =>
      InvestigationRateLimit.findOneAndUpdate(
        { key: u.key },
        {
          $inc: { count: 1 },
          $setOnInsert: {
            scope: u.scope,
            adminId: u.adminId,
            tenantId: u.tenantId,
            expiresAt: u.expiresAt
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    )
  );
}

