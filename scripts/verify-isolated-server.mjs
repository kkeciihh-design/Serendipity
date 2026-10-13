import path from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertTestDataPath, assertTestDataTree } from "./test-data-safety.mjs";
/* global AbortSignal, URL */

// The browser may only write after its server has read a fresh marker from the
// explicitly isolated database. A fixed port and a fixed DB path are not proof.
export async function openVerifiedIsolatedDatabase(base, dataDirectory) {
  const origin = new URL(base);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.origin !== base) {
    throw new Error("Isolation verification requires an explicit loopback origin.");
  }
  const directory = assertTestDataTree(path.resolve(dataDirectory, "data"));
  const databasePath = assertTestDataPath(path.join(directory, "serendipity.db"));
  const database = new PrismaClient({ datasources: { db: { url: `file:${databasePath.replaceAll("\\", "/")}` } } });
  const markerId = `isolation-${randomUUID()}`;
  let created = false;
  let verified = false;
  let cleaned = false;
  try {
    await database.trip.create({ data: {
      id: markerId, title: "临时测试库隔离校验（非旅行数据）", originalRequest: markerId, status: "draft",
    } });
    created = true;
    const response = await fetch(`${base}/api/trips/${markerId}`, {
      method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Isolation verification failed: the server does not expose the test database marker.");
    const body = await response.json();
    if (body?.trip?.id !== markerId || body.trip.originalRequest !== markerId) {
      throw new Error("Isolation verification failed: server and test database do not match.");
    }
    verified = true;
    return database;
  } finally {
    try {
      if (created) await database.trip.deleteMany({ where: { id: markerId, originalRequest: markerId } });
      cleaned = true;
    } finally {
      if (!verified || !cleaned) await database.$disconnect();
    }
  }
}
