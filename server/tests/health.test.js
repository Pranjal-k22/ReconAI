import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import * as dbModule from "../src/config/database.js";

describe("GET /api/health Semantics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test D: should return 200 OK and healthy status when database is connected", async () => {
    vi.spyOn(dbModule, "getDatabaseStatus").mockReturnValue("connected");

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      service: "reconai-api",
      status: "healthy",
      database: {
        status: "connected"
      }
    });
  });

  it("Test E: should return 503 Service Unavailable and degraded status when database is disconnected", async () => {
    vi.spyOn(dbModule, "getDatabaseStatus").mockReturnValue("disconnected");

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      service: "reconai-api",
      status: "degraded",
      database: {
        status: "disconnected"
      }
    });
  });
});
