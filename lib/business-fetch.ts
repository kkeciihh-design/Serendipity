"use client";

import { PLANNING_REQUEST_TIMEOUT_MS } from "./planning-timeouts";

let pageGeneration: string | null = null;
export function documentGeneration() {
  pageGeneration ??= document.querySelector<HTMLMetaElement>('meta[name="serendipity-data-generation"]')?.content ?? "";
  return pageGeneration;
}
export async function businessFetch(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("x-data-generation", documentGeneration());
  const url = input instanceof Request ? input.url : String(input);
  const isPlanningRequest = /\/api\/trips\/[^/?]+\/(?:request\/extract|plans\/generate)(?:\?|$)/.test(url);
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const timeout = isPlanningRequest ? AbortSignal.timeout(PLANNING_REQUEST_TIMEOUT_MS) : undefined;
  const signal = timeout ? (callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout) : callerSignal;
  const response = await fetch(input, { ...init, headers, ...(signal ? { signal } : {}) });
  if (response.status === 409 || response.status === 423) {
    const payload = await response.clone().json().catch(() => null);
    if (payload?.reloadRequired) window.dispatchEvent(new CustomEvent("serendipity-data-changed", { detail: payload.error }));
  }
  return response;
}
