import { describe, it, expect } from "vitest";
import { validateEnv } from "../src/config/env.js";

describe("MongoDB Startup Environment Invariant", () => {
  it("Test A: test environment permits missing MONGODB_URI", () => {
    const customEnv = {
      PORT: "5000",
      NODE_ENV: "test",
      CLIENT_URL: "http://localhost:5173",
      MONGODB_URI: "",
      DEMO_MODE: "true"
    };

    const env = validateEnv(customEnv);
    expect(env).toBeDefined();
    expect(env.NODE_ENV).toBe("test");
    expect(env.MONGODB_URI).toBe("");
  });

  it("Test B: development environment rejects missing MONGODB_URI", () => {
    const customEnv = {
      PORT: "5000",
      NODE_ENV: "development",
      CLIENT_URL: "http://localhost:5173",
      MONGODB_URI: "",
      DEMO_MODE: "true"
    };

    expect(() => validateEnv(customEnv)).toThrow(
      "MONGODB_URI is required in development and production modes"
    );
  });

  it("Test C: production environment rejects missing MONGODB_URI", () => {
    const customEnv = {
      PORT: "5000",
      NODE_ENV: "production",
      CLIENT_URL: "http://localhost:5173",
      MONGODB_URI: "",
      DEMO_MODE: "true"
    };

    expect(() => validateEnv(customEnv)).toThrow(
      "MONGODB_URI is required in development and production modes"
    );
  });

  it("should accept valid MONGODB_URI in development mode", () => {
    const customEnv = {
      PORT: "5000",
      NODE_ENV: "development",
      CLIENT_URL: "http://localhost:5173",
      MONGODB_URI: "mongodb://localhost:27017/reconai_dev",
      DEMO_MODE: "true"
    };

    const env = validateEnv(customEnv);
    expect(env.MONGODB_URI).toBe("mongodb://localhost:27017/reconai_dev");
  });
});
