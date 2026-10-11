export const SESSION_COOKIE_NAME = "serendipity_session";
export const CSRF_COOKIE_NAME = "serendipity_csrf";

// URL classification for explicitly configured local AI endpoints, not identity.
export function isLoopbackHost(host: string | null | undefined) {
  if (!host) return false;
  try {
    const url = new URL(`http://${host}`);
    return !url.username && !url.password && url.pathname === "/" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

function parseOrigin(value: string | null | undefined) {
  if (!value || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value) return null;
    return url;
  } catch {
    return null;
  }
}

function localOrigins() {
  // Set ONLY by scripts/serve.mjs, together with a literal loopback bind.
  // Direct `next start` and remote listeners have no anonymous local mode.
  if (process.env.SERENDIPITY_PUBLIC_ORIGIN || process.env.SERENDIPITY_TRUST_PROXY) return [];
  const port = process.env.SERENDIPITY_LOCAL_PORT;
  if (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) return [];
  return ["127.0.0.1", "localhost", "[::1]"].map(
    (host) => new URL(`http://${host}:${port}`).origin,
  );
}

export function isLocalHeaders(headers: Pick<Headers, "get">) {
  const host = headers.get("host");
  return localOrigins().some((origin) => new URL(origin).host === host);
}

export function isLocalRequest(request: Request) {
  // Host validates the destination; the server's loopback-only configuration
  // establishes local access. Neither Host nor forwarding headers establish identity.
  return isLocalHeaders(request.headers);
}

export function hasAllowedHost(request: Request) {
  if (isLocalRequest(request)) return true;
  const origin = parseOrigin(process.env.SERENDIPITY_PUBLIC_ORIGIN);
  return origin?.protocol === "https:" && request.headers.get("host") === origin.host;
}

export function isSecureRequest(request: Request) {
  if (isLocalRequest(request)) return true;
  if (!hasAllowedHost(request)) return false;
  // A TLS-terminating proxy must be explicitly trusted by the operator and
  // must be the only route to the server. Arbitrary forwarding headers do not opt in.
  // Next's Request URL can itself be reconstructed from forwarding headers.
  // This HTTP launcher has no direct TLS mode: remote use requires an explicitly
  // trusted TLS proxy with backend access restricted to that proxy.
  return process.env.SERENDIPITY_TRUST_PROXY === "1" &&
    request.headers.get("x-forwarded-proto") === "https";
}

export function hasTrustedOrigin(request: Request) {
  if (!hasAllowedHost(request)) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = parseOrigin(request.headers.get("origin"));
  if (!origin || origin.host !== request.headers.get("host")) return false;
  return isLocalRequest(request)
    ? localOrigins().includes(origin.origin)
    : origin.origin === process.env.SERENDIPITY_PUBLIC_ORIGIN && isSecureRequest(request);
}

export function isJsonWrite(request: Request) {
  return request.method === "DELETE" ||
    /^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "");
}

export function getCookieValue(request: Request, name: string) {
  const values = (request.headers.get("cookie") ?? "").split(";").flatMap((part) => {
    const index = part.indexOf("=");
    return index >= 0 && part.slice(0, index).trim() === name
      ? [part.slice(index + 1).trim()]
      : [];
  });
  if (values.length !== 1 || !values[0] || values[0].length > 4096) return null;
  try {
    return decodeURIComponent(values[0]);
  } catch {
    return null;
  }
}
