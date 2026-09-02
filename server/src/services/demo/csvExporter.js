import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.resolve(__dirname, "../../../data/generated");

/**
 * Escapes CSV cell value safely.
 */
function escapeCsvValue(val) {
  if (val === null || val === undefined) return "";
  if (val instanceof Date) return val.toISOString();
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts array of objects to CSV string.
 */
export function objectsToCsv(objects, headers) {
  if (!objects || objects.length === 0) return headers.join(",") + "\n";

  const rows = [];
  rows.push(headers.join(","));

  for (const obj of objects) {
    const row = headers.map((header) => escapeCsvValue(obj[header]));
    rows.push(row.join(","));
  }

  return rows.join("\n") + "\n";
}

/**
 * Exports generated benchmark data to CSV and JSON files in data/generated/
 */
export function exportBenchmarkToFiles(benchmarkData, targetDir = OUTPUT_DIR) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 1. Export Merchant Orders CSV
  const orderHeaders = [
    "merchantOrderId",
    "customerReference",
    "amountPaise",
    "currency",
    "status",
    "createdAtSource",
    "source",
    "importBatchId"
  ];
  const ordersCsv = objectsToCsv(benchmarkData.merchantOrders, orderHeaders);
  fs.writeFileSync(path.join(targetDir, "merchant_orders.csv"), ordersCsv, "utf8");

  // 2. Export Gateway Payments CSV
  const paymentHeaders = [
    "gatewayPaymentId",
    "merchantOrderId",
    "amountPaise",
    "currency",
    "status",
    "method",
    "feePaise",
    "taxPaise",
    "refundAmountPaise",
    "gatewayCreatedAt",
    "source",
    "importBatchId"
  ];
  const paymentsCsv = objectsToCsv(benchmarkData.gatewayPayments, paymentHeaders);
  fs.writeFileSync(path.join(targetDir, "gateway_payments.csv"), paymentsCsv, "utf8");

  // 3. Export Settlement Records CSV
  const settlementHeaders = [
    "settlementRecordId",
    "settlementId",
    "entityId",
    "merchantOrderId",
    "grossAmountPaise",
    "feePaise",
    "taxPaise",
    "netAmountPaise",
    "currency",
    "settledAt",
    "utr",
    "type",
    "source",
    "importBatchId"
  ];
  const settlementsCsv = objectsToCsv(benchmarkData.settlementRecords, settlementHeaders);
  fs.writeFileSync(path.join(targetDir, "settlements.csv"), settlementsCsv, "utf8");

  // 4. Export GroundTruth JSON (Isolated)
  fs.writeFileSync(
    path.join(targetDir, "ground_truth.json"),
    JSON.stringify(benchmarkData.groundTruth, null, 2),
    "utf8"
  );

  // 5. Export Summary JSON
  fs.writeFileSync(
    path.join(targetDir, "dataset_summary.json"),
    JSON.stringify(benchmarkData.summary, null, 2),
    "utf8"
  );

  return {
    targetDir,
    files: [
      "merchant_orders.csv",
      "gateway_payments.csv",
      "settlements.csv",
      "ground_truth.json",
      "dataset_summary.json"
    ]
  };
}
