import { describe, it, expect } from "vitest";
import {
  ServicePrincipal,
  hashServiceCredential,
  verifyServiceCredential,
  SERVICE_ROLES
} from "../../src/models/ServicePrincipal.js";

describe("ServicePrincipal Model Schema & Validation", () => {
  it("validates a compliant ServicePrincipal document", async () => {
    const { hash, salt } = hashServiceCredential("ValidServiceSecret123!");
    const principal = new ServicePrincipal({
      serviceId: "svc_valid_test",
      serviceRole: "PAYMENT_CONTROLLER",
      scopes: ["PROPOSE_ACTION", "APPEND_EVENT"],
      credentialHash: hash,
      credentialSalt: salt,
      isActive: true,
      credentialVersion: 1
    });

    const err = await principal.validate();
    expect(err).toBeUndefined();
  });

  it("rejects non-approved service roles", async () => {
    const { hash, salt } = hashServiceCredential("ValidServiceSecret123!");
    const principal = new ServicePrincipal({
      serviceId: "svc_bad_role",
      serviceRole: "ADMIN", // Human role not permitted for service principal
      credentialHash: hash,
      credentialSalt: salt
    });

    await expect(principal.validate()).rejects.toThrow(/Invalid service role/i);
  });

  it("rejects missing serviceId, serviceRole, credentialHash, or credentialSalt", async () => {
    const principal = new ServicePrincipal({
      metadata: { env: "test" }
    });

    await expect(principal.validate()).rejects.toThrow();
  });

  it("derives distinct salts and verifies service credentials in timing-safe constant time", () => {
    const secret = "TestSecretForHashing123!";
    const creds1 = hashServiceCredential(secret);
    const creds2 = hashServiceCredential(secret);

    expect(creds1.salt).not.toBe(creds2.salt);
    expect(creds1.hash).not.toBe(creds2.hash);

    expect(verifyServiceCredential(secret, creds1.hash, creds1.salt)).toBe(true);
    expect(verifyServiceCredential(secret, creds2.hash, creds2.salt)).toBe(true);
    expect(verifyServiceCredential("WrongSecretValue123!", creds1.hash, creds1.salt)).toBe(false);
  });
});
