import { timingSafeEqual } from "node:crypto";
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  getCookieValue,
  hasTrustedOrigin,
  hasAllowedHost,
  isLocalRequest,
  isSecureRequest,
  isJsonWrite,
} from "./request-security";
import { verifySessionToken } from "./security";

export function hasSettingsSession(request: Request) {
  return hasAllowedHost(request) && isSecureRequest(request) &&
    verifySessionToken(getCookieValue(request, SESSION_COOKIE_NAME));
}

export function hasAppAccess(request: Request) {
  return isLocalRequest(request) || hasSettingsSession(request);
}

export function hasValidCsrf(request: Request) {
  const header = request.headers.get("x-csrf-token");
  const cookie = getCookieValue(request, CSRF_COOKIE_NAME);
  return hasTrustedOrigin(request) && isJsonWrite(request) &&
    typeof header === "string" && typeof cookie === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(header) && /^[A-Za-z0-9_-]{43}$/.test(cookie) &&
    timingSafeEqual(Buffer.from(header), Buffer.from(cookie));
}

export function appWriteAccessError(request: Request) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  if (!hasTrustedOrigin(request) || !isJsonWrite(request)) {
    return Response.json({ error: "请求来源不可信，请从本应用页面重试。" }, { status: 403 });
  }
  return null;
}

export function unauthorizedResponse(message = "请先验证个人密码。") {
  return Response.json({ error: message }, { status: 401 });
}

type PrismaGlobal = typeof globalThis & {
  serendipityLoginAttempts?: Map<string, { count: number; lockedUntil: number }>;
};

const loginAttemptsGlobal = globalThis as PrismaGlobal;
const loginAttempts =
  loginAttemptsGlobal.serendipityLoginAttempts ?? new Map<
    string,
    { count: number; lockedUntil: number }
  >();
loginAttemptsGlobal.serendipityLoginAttempts = loginAttempts;

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

export function loginRateLimitKey() {
  // One personal account; untrusted forwarding headers must not reset its limit.
  return "personal-account";
}

export function isLoginRateLimited() {
  const key = loginRateLimitKey();
  const record = loginAttempts.get(key);
  if (!record) {
    return false;
  }

  if (record.lockedUntil > Date.now()) {
    return true;
  }

  if (record.lockedUntil !== 0 && record.lockedUntil <= Date.now()) {
    loginAttempts.delete(key);
  }
  return false;
}

export function recordFailedLogin() {
  const key = loginRateLimitKey();
  const record = loginAttempts.get(key) ?? { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= LOGIN_ATTEMPT_LIMIT) {
    record.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
  }
  loginAttempts.set(key, record);
}

export function clearFailedLogins() {
  loginAttempts.delete(loginRateLimitKey());
}
