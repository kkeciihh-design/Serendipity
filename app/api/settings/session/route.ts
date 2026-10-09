import { NextResponse } from "next/server";
import {
  clearFailedLogins,
  isLoginRateLimited,
  hasSettingsSession,
  hasValidCsrf,
  recordFailedLogin,
  unauthorizedResponse,
} from "@/lib/access";
import { createCsrfToken, createSessionToken } from "@/lib/security";
import {
  hasTrustedOrigin,
  isLocalRequest,
  isSecureRequest,
} from "@/lib/request-security";
import { checkPassword } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_TTL_SECONDS = 12 * 60 * 60;

function setSessionCookies(response: NextResponse, request: Request) {
  response.cookies.set({
    name: "serendipity_session",
    value: createSessionToken(SESSION_TTL_SECONDS * 1000),
    httpOnly: true,
    sameSite: "lax",
    secure: !isLocalRequest(request),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  response.cookies.set({
    name: "serendipity_csrf",
    value: createCsrfToken(),
    httpOnly: false,
    sameSite: "lax",
    secure: !isLocalRequest(request),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "请求来源不可信。" },
      { status: 403 },
    );
  }

  if (!isSecureRequest(request)) {
    return NextResponse.json(
      { error: "远程访问必须使用 HTTPS。" },
      { status: 400 },
    );
  }

  if (isLoginRateLimited(request)) {
    return NextResponse.json(
      { error: "尝试次数过多，请 15 分钟后再试。" },
      { status: 429 },
    );
  }

  try {
    const valid = await checkPassword(await request.json());
    if (!valid) {
      recordFailedLogin(request);
      return NextResponse.json(
        { error: "个人密码不正确。" },
        { status: 401 },
      );
    }

    clearFailedLogins(request);
    const response = NextResponse.json({ authenticated: true });
    setSessionCookies(response, request);
    return response;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "请求格式不正确。" },
        { status: 400 },
      );
    }

    console.error("Settings login failed", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: "验证个人密码失败，请稍后再试。" },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!hasSettingsSession(request) || !hasValidCsrf(request)) {
    return unauthorizedResponse();
  }

  const response = NextResponse.json({ authenticated: false });
  response.cookies.delete("serendipity_session");
  response.cookies.delete("serendipity_csrf");
  return response;
}
