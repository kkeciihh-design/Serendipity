import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasAppAccess } from "./lib/access";

export function proxy(request: NextRequest) {
  if (hasAppAccess(request)) {
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
  // Public sample artwork must also work in Next's internal image optimizer.
  matcher: "/((?!_next/static|_next/image|images/|favicon.ico|icon.svg).*)",
};
