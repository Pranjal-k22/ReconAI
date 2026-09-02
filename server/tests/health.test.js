import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";

describe("GET /api/health", () => {
  it("should return HTTP 200 with service health and database status", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("success", true);
    expect(response.body).toHaveProperty("service", "reconai-api");
    expect(response.body).toHaveProperty("status", "healthy");
    expect(response.body).toHaveProperty("database");
    expect(response.body.database).toHaveProperty("status");
    expect(typeof response.body.database.status).toBe("string");
  });
});
