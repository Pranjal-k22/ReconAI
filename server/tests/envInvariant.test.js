import { describe, it, expect, afterEach } from "vitest";
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

import { validateTestDatabaseUri } from "./helpers/testDbGuard.js";

describe("Test Database Host and Name Guards (V7)", () => {
  const originalAllowRemote = process.env.ALLOW_REMOTE_TEST_DB;

  afterEach(() => {
    if (originalAllowRemote === undefined) {
      delete process.env.ALLOW_REMOTE_TEST_DB;
    } else {
      process.env.ALLOW_REMOTE_TEST_DB = originalAllowRemote;
    }
  });

  it("accepts localhost and 127.0.0.1 with test in database name", () => {
    expect(validateTestDatabaseUri("mongodb://127.0.0.1:27017/reconai_test")).toBe(
      "mongodb://127.0.0.1:27017/reconai_test"
    );
    expect(validateTestDatabaseUri("mongodb://localhost:27017/reconai_test_db")).toBe(
      "mongodb://localhost:27017/reconai_test_db"
    );
  });

  it("refuses remote host by default without ALLOW_REMOTE_TEST_DB=true", () => {
    delete process.env.ALLOW_REMOTE_TEST_DB;
    expect(() =>
      validateTestDatabaseUri("mongodb://cluster0.abcde.mongodb.net/reconai_test")
    ).toThrow(/Remote test databases are refused unless ALLOW_REMOTE_TEST_DB=true/);

    expect(() =>
      validateTestDatabaseUri("mongodb://192.168.1.50:27017/reconai_test")
    ).toThrow(/Remote test databases are refused unless ALLOW_REMOTE_TEST_DB=true/);
  });

  it("permits remote host only when ALLOW_REMOTE_TEST_DB=true", () => {
    process.env.ALLOW_REMOTE_TEST_DB = "true";
    expect(
      validateTestDatabaseUri("mongodb://cluster0.abcde.mongodb.net/reconai_test")
    ).toBe("mongodb://cluster0.abcde.mongodb.net/reconai_test");
  });

  it("still refuses remote host when ALLOW_REMOTE_TEST_DB=true if name lacks 'test'", () => {
    process.env.ALLOW_REMOTE_TEST_DB = "true";
    expect(() =>
      validateTestDatabaseUri("mongodb://cluster0.abcde.mongodb.net/my_analytics")
    ).toThrow(/must contain 'test'/);
  });

  it("still refuses remote host when ALLOW_REMOTE_TEST_DB=true if name contains 'prod'", () => {
    process.env.ALLOW_REMOTE_TEST_DB = "true";
    expect(() =>
      validateTestDatabaseUri("mongodb://cluster0.abcde.mongodb.net/prod_test_db")
    ).toThrow(/contains 'prod'/);
  });
});
