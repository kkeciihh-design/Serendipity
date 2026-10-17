export type ClockAnchor = { server: number; wall: number; monotonic: number; skewed: boolean };
export function calibrateTravelClock(serverNow: string, sent: number, received: number, monotonic: number): ClockAnchor {
  const server = Date.parse(serverNow) + Math.max(0, received - sent) / 2;
  if (!Number.isFinite(server)) throw new Error("服务器时间无效。");
  return { server, wall: received, monotonic, skewed: Math.abs(server - received) > 120_000 };
}
export function readTravelClock(anchor: ClockAnchor, wall: number, monotonic: number) {
  const elapsed = monotonic - anchor.monotonic, wallElapsed = wall - anchor.wall;
  const jumped = Math.abs(elapsed - wallElapsed) > 2000;
  // On platforms whose monotonic clock pauses during sleep, do not freeze the
  // countdown. A wall jump makes the time uncertain until another server read.
  return { now: anchor.server + Math.max(elapsed, wallElapsed), reliable: !jumped && !anchor.skewed, jumped };
}
