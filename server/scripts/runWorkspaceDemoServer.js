process.env.NODE_ENV = "test";
process.env.PORT = "5000";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/reconai_test_workspace_demo";
if (!process.env.JWT_SECRET || typeof process.env.JWT_SECRET !== "string" || process.env.JWT_SECRET.trim().length === 0) {
  console.error("[DemoServer] Error: JWT_SECRET environment variable is required; hardcoded secret prohibited.");
  process.exit(1);
}
process.env.MONITORING_WORKER_ENABLED = "false";
process.env.ORCHESTRATOR_WORKER_ENABLED = "false";
process.env.RAZORPAY_SANDBOX_WRITES_ENABLED = "false";

console.log("[DemoServer] Starting ReconAI API Server on isolated test DB on port 5000...");
const { startServer } = await import("../src/server.js");

startServer()
  .then(() => {
    console.log("[DemoServer] ReconAI API Server ready at http://127.0.0.1:5000");
  })
  .catch((err) => {
    console.error("[DemoServer] Failed to start:", err);
    process.exit(1);
  });
