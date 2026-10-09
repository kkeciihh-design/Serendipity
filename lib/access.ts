import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  getCookieValue,
  hasTrustedOrigin,
  isLocalRequest,
} from "./request-security";
import { verifySessionToken } from "./security";

export function hasSettingsSession(request: Request) {
  return verifySessionToken(getCookieValue(request, SESSION_COOKIE_NAME));
}

export function hasAppAccess(request: Request) {
  return isLocalRequest(request) || hasSettingsSession(request);
}

export function hasValidCsrf(request: Request) {
  return (
    hasTrustedOrigin(request) &&
    request.headers.get("x-csrf-token") ===
      getCookieValue(request, CSRF_COOKIE_NAME)
  );
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

export function loginRateLimitKey(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    request.headers.get("host") ??
    "unknown"
  );
}

export function isLoginRateLimited(request: Request) {
  const key = loginRateLimitKey(request);
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

export function recordFailedLogin(request: Request) {
  const key = loginRateLimitKey(request);
  const record = loginAttempts.get(key) ?? { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= LOGIN_ATTEMPT_LIMIT) {
    record.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
  }
  loginAttempts.set(key, record);
}

export function clearFailedLogins(request: Request) {
  loginAttempts.delete(loginRateLimitKey(request));
}
