// Test-only preload. It is never imported by the application. Forks and worker
// threads inherit NODE_OPTIONS, so the real OCR process tree has the same guard.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import dgram from "node:dgram";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import { syncBuiltinESMExports } from "node:module";
import { isMainThread, threadId } from "node:worker_threads";
import { assertTestDataPath } from "../test-data-safety.mjs";

if (process.env.SERENDIPITY_VERIFY_OCR_OFFLINE !== "1") throw new Error("OCR network guard is test-only.");
const log = assertTestDataPath(process.env.SERENDIPITY_OCR_NETWORK_LOG ?? "");
const identity = { pid: process.pid, threadId, isMainThread };
const record = (entry) => fs.appendFileSync(log, `${JSON.stringify({ ...identity, ...entry })}\n`);
let probing = false;
const deny = (api) => () => {
  // Do not record URLs, hostnames, request bodies, image bytes, or OCR text.
  record({ event: probing ? "probe" : "blocked", api });
  const error = new Error(`Offline OCR verification blocked ${api}`);
  error.code = "OCR_NETWORK_BLOCKED";
  throw error;
};
const probes = [];
function replace(owner, name, label) {
  owner[name] = deny(label);
  probes.push(() => owner[name]());
}
replace(net.Socket.prototype, "connect", "net.Socket.connect");
replace(net, "connect", "net.connect");
replace(net, "createConnection", "net.createConnection");
replace(tls, "connect", "tls.connect");
replace(dgram.Socket.prototype, "connect", "dgram.connect");
replace(dgram.Socket.prototype, "send", "dgram.send");
for (const [label, owner] of [["dns", dns], ["dns.promises", dnsPromises]]) {
  for (const name of Object.keys(owner).filter((key) => /^(?:lookup|resolve|reverse)/.test(key) && typeof owner[key] === "function")) {
    replace(owner, name, `${label}.${name}`);
  }
}
for (const [label, owner] of [["http", http], ["https", https]]) {
  replace(owner, "request", `${label}.request`);
  replace(owner, "get", `${label}.get`);
}
replace(http2, "connect", "http2.connect");
replace(globalThis, "fetch", "fetch");
syncBuiltinESMExports();
probing = true;
for (const probe of probes) {
  try { probe(); throw new Error("Network guard probe did not block."); }
  catch (error) { if (error.code !== "OCR_NETWORK_BLOCKED") throw error; }
}
probing = false;
record({ event: "ready", checkedApis: probes.length, entrypoint: path.basename(process.argv[1] ?? "") });
