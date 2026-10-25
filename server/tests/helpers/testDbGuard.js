/**
 * ReconAI 2.0 - Shared Test Database URI Guard
 *
 * Enforces strict isolation invariants for test execution:
 * 1. Must use mongodb:// or mongodb+srv://
 * 2. Must not match development/app MONGODB_URI
 * 3. Host must be localhost or 127.0.0.1 unless ALLOW_REMOTE_TEST_DB === "true"
 * 4. Database name must explicitly contain "test"
 * 5. Database name must never contain "prod"
 */
export function validateTestDatabaseUri(uri) {
  if (!uri || typeof uri !== "string") {
    throw new Error("MONGODB_TEST_URI must be provided as a non-empty string");
  }

  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    throw new Error("Invalid MONGODB_TEST_URI scheme: must start with mongodb:// or mongodb+srv://");
  }

  if (process.env.MONGODB_URI && uri.trim() === process.env.MONGODB_URI.trim()) {
    throw new Error(
      "Safety violation: MONGODB_TEST_URI matches development/app MONGODB_URI. Integration tests require an isolated test database."
    );
  }

  let hostname = "";
  let dbName = "";

  try {
    const url = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, "http://"));
    hostname = url.hostname;
    dbName = url.pathname.replace(/^\//, "");
  } catch {
    const match = uri.match(/^mongodb(?:\+srv)?:\/\/([^/:?#]+)(?::\d+)?\/([^/?]+)/);
    if (match) {
      hostname = match[1];
      dbName = match[2];
    }
  }

  // Host Guard: Refuse any host other than localhost or 127.0.0.1 unless explicitly permitted
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
  const allowRemote = process.env.ALLOW_REMOTE_TEST_DB === "true";

  if (!isLocalHost && !allowRemote) {
    throw new Error(
      `Safety violation: MONGODB_TEST_URI host '${hostname}' is not localhost/127.0.0.1. Remote test databases are refused unless ALLOW_REMOTE_TEST_DB=true.`
    );
  }

  if (!dbName) {
    throw new Error("Safety violation: MONGODB_TEST_URI must explicitly specify a database name.");
  }

  const lowerName = dbName.toLowerCase();
  if (!lowerName.includes("test")) {
    throw new Error(
      `Safety violation: Test database name '${dbName}' must contain 'test' to guarantee isolation.`
    );
  }

  if (lowerName.includes("prod")) {
    throw new Error(
      `Safety violation: Test database name '${dbName}' contains 'prod'. Execution refused.`
    );
  }

  return uri;
}
