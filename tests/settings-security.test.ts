import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDataDirectory = path.resolve("test-data", "unit-security");
let security: typeof import("../lib/security");

beforeAll(async () => {
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
  fs.mkdirSync(testDataDirectory, { recursive: true });
  process.env.SERENDIPITY_DATA_DIR = testDataDirectory;
  security = await import("../lib/security");
});

afterAll(() => {
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
});

describe("settings security", () => {
  it("round-trips an API key without storing plaintext", () => {
    const secret = "sk-test-secret-value";
    const encrypted = security.encryptSecret(secret);

    expect(encrypted).not.toContain(secret);
    expect(security.decryptSecret(encrypted)).toBe(secret);
  });

  it("hashes and verifies the personal password", () => {
    const { hash, salt } = security.hashPassword("correct horse battery");

    expect(security.verifyPassword("correct horse battery", salt, hash)).toBe(true);
    expect(security.verifyPassword("wrong password", salt, hash)).toBe(false);
  });

  it("accepts a signed session and rejects tampering or expiry", () => {
    const token = security.createSessionToken(60 * 1000);
    expect(security.verifySessionToken(token)).toBe(true);
    expect(security.verifySessionToken(`${token}x`)).toBe(false);
    expect(security.verifySessionToken(security.createSessionToken(-1))).toBe(false);
  });
});
