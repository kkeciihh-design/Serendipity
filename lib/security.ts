import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDataDirectory } from "./data-directory";

const SECURITY_KEY_SIZE = 64;

type PrismaGlobal = typeof globalThis & {
  serendipitySecurityKey?: Buffer;
};

const prismaGlobal = globalThis as PrismaGlobal;

function readSecurityKey() {
  if (prismaGlobal.serendipitySecurityKey) {
    return prismaGlobal.serendipitySecurityKey;
  }

  const dataDirectory = getDataDirectory();
  fs.mkdirSync(dataDirectory, { recursive: true });
  const keyPath = path.join(dataDirectory, "security.key");

  if (fs.existsSync(keyPath)) {
    const existingKey = fs.readFileSync(keyPath);
    if (existingKey.length !== SECURITY_KEY_SIZE) {
      throw new Error("本机安全材料长度不正确。");
    }
    prismaGlobal.serendipitySecurityKey = existingKey;
    return existingKey;
  }

  const newKey = crypto.randomBytes(SECURITY_KEY_SIZE);
  fs.writeFileSync(keyPath, newKey, { mode: 0o600 });
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    // Windows does not fully honor POSIX modes; the user-profile directory
    // remains the primary access boundary.
  }

  prismaGlobal.serendipitySecurityKey = newKey;
  return newKey;
}

function derivedKey(purpose: string) {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      readSecurityKey(),
      Buffer.alloc(0),
      Buffer.from(`serendipity/${purpose}`, "utf8"),
      32,
    ),
  );
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
    .toString("hex");
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actualHash = crypto
    .scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
    .toString("hex");
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return (
    actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  );
}

export function encryptSecret(plaintext: string) {
  const key = derivedKey("settings-encryption");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string) {
  const [ivValue, tagValue, ciphertextValue] = payload.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new Error("密钥存储格式不正确。");
  }

  const key = derivedKey("settings-encryption");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function sign(value: string) {
  const key = derivedKey("session-signing");
  return crypto
    .createHmac("sha256", key)
    .update(value)
    .digest("base64url");
}

export function createSessionToken(expiresInMilliseconds: number) {
  const payload = {
    scope: "settings",
    exp: Date.now() + expiresInMilliseconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionToken(token: string | null | undefined) {
  if (!token) {
    return false;
  }

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || sign(encoded) !== signature) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as { scope?: unknown; exp?: unknown };
    return (
      payload.scope === "settings" &&
      typeof payload.exp === "number" &&
      payload.exp > Date.now()
    );
  } catch {
    return false;
  }
}

export function createCsrfToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function createSignedPayload(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encoded}.${sign(encoded)}`;
}

export function verifySignedPayload<T extends Record<string, unknown>>(
  token: string | null | undefined,
) {
  if (!token) {
    return null;
  }

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || sign(encoded) !== signature) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as T;
  } catch {
    return null;
  }
}
