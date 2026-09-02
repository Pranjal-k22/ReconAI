import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { AppError } from "../src/utils/AppError.js";
import { validateEnv } from "../src/config/env.js";

describe("Backend Infrastructure & Error Middleware", () => {
  it("should return 404 JSON response for unknown routes", async () => {
    const response = await request(app).get("/api/unknown-endpoint-route");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Route not found: GET /api/unknown-endpoint-route"
      }
    });
  });

  it("should validate default environment configuration cleanly", () => {
    const env = validateEnv();
    expect(env).toBeDefined();
    expect(typeof env.PORT).toBe("number");
    expect(env.NODE_ENV).toBe("test");
    expect(typeof env.DEMO_MODE).toBe("boolean");
  });

  it("should construct AppError instances with safe defaults", () => {
    const err = new AppError("Test error", 400, "BAD_REQUEST", { field: "test" });
    expect(err.message).toBe("Test error");
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.details).toEqual({ field: "test" });
    expect(err.isOperational).toBe(true);
  });
});
