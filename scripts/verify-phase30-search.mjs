import fs from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { assertTestDataPath } from "./test-data-safety.mjs";
import { fetchPinned, lookupPublicHost, resolvePublicAddress } from "../lib/source-http.ts";
const url = "https://html.duckduckgo.com/html/?q=Hunan%20Museum%20opening%20hours%20official&kl=us-en";
const signal = globalThis.AbortSignal.timeout(15000), target = new URL(url);
const response = await fetchPinned(target, await resolvePublicAddress(target, lookupPublicHost, signal), signal);
const html = await response.text();
const result = { at: new Date().toISOString(), transport: "production pinned connector", status: response.status, bytes: html.length, encoding: response.headers.get("content-encoding"),
  title: html.match(/<title>([\s\S]*?)<\/title>/i)?.[1],
  challenge: /anomaly|captcha|bots use DuckDuckGo|challenge-form/i.test(html),
  resultAnchors: [...html.matchAll(/<a\b[^>]*class=["'][^"']*result__a[^>]*>/gi)].slice(0, 5).map((m) => m[0]),
};
await fs.writeFile(assertTestDataPath(path.resolve("test-data/verification-output/phase30/search-pinned-diagnostic.json")), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
