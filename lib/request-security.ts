export const SESSION_COOKIE_NAME = "serendipity_session";
export const CSRF_COOKIE_NAME = "serendipity_csrf";

export function isLoopbackHost(host: string | null | undefined) {
  if (!host) {
    return false;
  }

  try {
    const hostname = new URL(`http://${host}`).hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

export function isLocalRequest(request: Request) {
  return isLoopbackHost(request.headers.get("host"));
}

export function isSecureRequest(request: Request) {
  if (isLocalRequest(request)) {
    return true;
  }

  const forwardedProto = request.headers.get("x-forwarded-proto");
  return forwardedProto?.split(",")[0]?.trim().toLowerCase() === "https";
}

export function hasTrustedOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    fetchSite &&
    fetchSite !== "same-origin" &&
    fetchSite !== "same-site" &&
    fetchSite !== "none"
  ) {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  try {
    const originHost = new URL(origin).host;
    const forwardedHost = request.headers.get("x-forwarded-host");
    return (
      originHost === request.headers.get("host") ||
      (forwardedHost !== null && originHost === forwardedHost)
    );
  } catch {
    return false;
  }
}

export function getCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const cookieName = part.slice(0, separatorIndex).trim();
    if (cookieName === name) {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    }
  }

  return null;
}
