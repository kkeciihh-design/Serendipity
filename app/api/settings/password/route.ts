import { NextResponse } from "next/server";
import { createCsrfToken, createSessionToken } from "@/lib/security";
import {
  hasTrustedOrigin,
  isLocalRequest,
  isSecureRequest,
} from "@/lib/request-security";
import {
  SettingsValidationError,
  setInitialPassword,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_TTL_SECONDS = 12 * 60 * 60;

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "请求来源不可信。" },
      { status: 403 },
    );
  }

  if (!isLocalRequest(request)) {
    return NextResponse.json(
      { error: "首次设置个人密码需要在本机完成。" },
      { status: 403 },
    );
  }

  if (!isSecureRequest(request)) {
    return NextResponse.json(
      { error: "远程访问必须使用 HTTPS。" },
      { status: 400 },
    );
  }

  try {
    await setInitialPassword(await request.json());

    const response = NextResponse.json({ passwordConfigured: true });
    response.cookies.set({
      name: "serendipity_session",
      value: createSessionToken(SESSION_TTL_SECONDS * 1000),
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    response.cookies.set({
      name: "serendipity_csrf",
      value: createCsrfToken(),
      httpOnly: false,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "请求格式不正确。" },
        { status: 400 },
      );
    }

    if (error instanceof SettingsValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    console.error("Initial password setup failed", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: "设置个人密码失败，请稍后再试。" },
      { status: 503 },
    );
  }
}
