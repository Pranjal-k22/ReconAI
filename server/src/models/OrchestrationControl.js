import mongoose from "mongoose";

/**
 * ReconAI 2.0 - OrchestrationControl Domain Model
 *
 * Persists process-shared operational controls across distributed nodes,
 * separate worker processes (e.g. `node src/worker.js`), and restarts.
 *
 * Invariants:
 * - Backs the operator kill switch durably in MongoDB.
 * - Prevents workers in separate processes from claiming tasks when killed.
 * - Process restart never silently restores an unsafe enabled state.
 * - Database unavailability fails closed.
 */

const orchestrationControlSchema = new mongoose.Schema(
  {
    controlKey: {
      type: String,
      required: true,
      unique: true,
      default: "GLOBAL_ORCHESTRATION_CONTROL",
      index: true
    },
    killSwitchActive: {
      type: Boolean,
      required: true,
      default: false
    },
    updatedBy: {
      type: String,
      trim: true,
      default: "SYSTEM"
    },
    reason: {
      type: String,
      trim: true,
      default: null
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

export const OrchestrationControl =
  mongoose.models.OrchestrationControl ||
  mongoose.model("OrchestrationControl", orchestrationControlSchema);

export default OrchestrationControl;
