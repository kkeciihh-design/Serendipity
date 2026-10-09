import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  isLoopbackHost,
} from "./lib/request-security";

export function proxy(request: NextRequest) {
  if (isLoopbackHost(request.nextUrl.host)) {
    return NextResponse.next();
  }

  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME));
  if (hasSessionCookie) {
    return NextResponse.next();
  }

  const path = request.nextUrl.pathname;
  if (
    path === "/settings" ||
    path === "/api/settings/password" ||
    path === "/api/settings/session"
  ) {
    return NextResponse.next();
  }

  if (path.startsWith("/api/")) {
    return NextResponse.json(
      { error: "请先验证个人密码。" },
      { status: 401 },
    );
  }

  const settingsUrl = request.nextUrl.clone();
  settingsUrl.pathname = "/settings";
  settingsUrl.search = "";
  return NextResponse.redirect(settingsUrl);
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
};
