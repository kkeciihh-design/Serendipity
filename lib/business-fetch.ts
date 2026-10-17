"use client";

let pageGeneration: string | null = null;
export function documentGeneration() {
  pageGeneration ??= document.querySelector<HTMLMetaElement>('meta[name="serendipity-data-generation"]')?.content ?? "";
  return pageGeneration;
}
export async function businessFetch(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("x-data-generation", documentGeneration());
  const response = await fetch(input, { ...init, headers });
  if (response.status === 409 || response.status === 423) {
    const payload = await response.clone().json().catch(() => null);
    if (payload?.reloadRequired) window.dispatchEvent(new CustomEvent("serendipity-data-changed", { detail: payload.error }));
  }
  return response;
}
