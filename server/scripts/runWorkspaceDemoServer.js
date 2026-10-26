process.env.NODE_ENV = "test";
process.env.PORT = "5000";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/reconai_test_workspace_demo";
process.env.JWT_SECRET = "test_secret_key_reconcile_ai_stage6_secure_2026";
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
