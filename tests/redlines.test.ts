import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { forwardCheck, formatRedlineTime, isoAt, redlineNeedsAttention, redlineUrgency, reverseCandidate, type RedlineInput, type TimingRoute } from "../lib/redlines";
import { resolveRedline, type RedlineRouteLookup } from "../lib/redline-resolver";
import { routeCacheKey, clearRouteCache, readCachedRoute } from "../lib/routes";
import { verificationEvidenceDirectory } from "./helpers/evidence-directory";

const at = (time: string, date = "2026-10-20") => isoAt(Date.parse(`${date}T${time}:00+08:00`));
function standard(): RedlineInput {
  return { id: "T09", eventId: "departure", direction: "departure", origin: "演示起点", destination: "演示站", departureAt: at("10:35"),
    route: { kind: "fixed", durationSeconds: 55 * 60, status: "estimated", source: "固定演示数据，不是实时地铁",
      applicableAt: null, validFrom: null, validUntil: null, futureCapability: false, includedTimes: ["walking", "waiting", "riding", "transfer"],
      details: [{ label: "步行", seconds: 600 }, { label: "候车", seconds: 300 }, { label: "乘车", seconds: 1800 }, { label: "出站", seconds: 600 }] },
    steps: [{ id: "security", label: "安检", seconds: 1200, reason: "演示" }, { id: "gate", label: "检票口", seconds: 600, reason: "演示" }],
    deadlines: [{ id: "boarding", label: "停止检票", afterStep: "gate", at: at("10:30"), nature: "assumed", source: "演示假定" }],
    buffers: [{ id: "extra", label: "机动", seconds: 600, reason: "演示" }], assumptions: ["不是官方规定"], blockers: [], earliestDepartureAt: null };
}
const fixedLookup: RedlineRouteLookup = async () => { throw new Error("Fixed routes do not query a service"); };

describe("redline overview visibility", () => {
  it("keeps a feasible distant departure out of the alert area, including an honest estimate", async () => {
    const result = await resolveRedline(standard(), at("08:00"), "quiet", fixedLookup);
    expect(result.precision).toBe("estimated");
    expect(redlineNeedsAttention(result, Date.parse(at("08:00")))).toBe(false);
    const verifiedInput = standard();
    verifiedInput.route.status = "verified";
    verifiedInput.deadlines[0].nature = "confirmed";
    const verified = await resolveRedline(verifiedInput, at("08:00"), "verified", fixedLookup);
    expect(verified.precision).toBe("verified");
    expect(redlineNeedsAttention(verified, Date.parse(at("08:00")))).toBe(false);
  });

  it("starts drawing attention at fifteen minutes, then retains overdue departures", async () => {
    const result = await resolveRedline(standard(), at("08:00"), "countdown", fixedLookup);
    expect(redlineNeedsAttention(result, Date.parse(at("08:39")))).toBe(false);
    for (const time of ["08:40", "08:55", "09:00", "09:06"]) {
      expect(redlineNeedsAttention(result, Date.parse(at(time)))).toBe(true);
    }
  });

  it("shows conflicting events, missing route data and an unreliable clock even well before departure", async () => {
    const input = standard();
    const clear = await resolveRedline(input, at("08:00"), "clear", fixedLookup);
    expect(redlineNeedsAttention(clear, Date.parse(at("08:00")), false)).toBe(true);
    input.earliestDepartureAt = at("09:00");
    const conflict = await resolveRedline(input, at("08:00"), "conflict", fixedLookup);
    expect(redlineNeedsAttention(conflict, Date.parse(at("08:00")))).toBe(true);
    input.earliestDepartureAt = null;
    input.route.durationSeconds = null;
    const incomplete = await resolveRedline(input, at("08:00"), "incomplete", fixedLookup);
    expect(redlineNeedsAttention(incomplete, Date.parse(at("08:00")))).toBe(true);
  });
});

describe("T09–T12 deterministic redlines", () => {
  it("T09: 08:55, 85 necessary minutes, continuous stages, 10 minutes buffer once", async () => {
    const r = await resolveRedline(standard(), at("08:47"), "V1", fixedLookup);
    expect(r.suggestedAt).toBe(at("08:55")); expect(r.necessarySeconds).toBe(85 * 60);
    expect(r.bufferSeconds).toBe(600); expect(r.precision).toBe("estimated");
    expect(r.suggestedCheck?.timeline.map((s) => [s.startAt, s.endAt])).toEqual([
      [at("08:55"), at("09:50")], [at("09:50"), at("10:10")], [at("10:10"), at("10:20")],
    ]);
    expect(r.suggestedCheck?.deadlines[0].slackSeconds).toBe(600);
    expect(r.suggestedCheck?.routeBreakdown.map((s) => s.endAt)).toEqual([at("09:05"), at("09:10"), at("09:40"), at("09:50")]);
    expect(r.currentCheck.departureAt).toBe(at("08:47"));
    expect(redlineUrgency(r.suggestedAt, Date.parse(at("08:47")))).toEqual({ color: "orange", remainingSeconds: 480 });
  });
  it("T10: route details and minimum arrival constraint never double-count", () => {
    const input = standard();
    input.deadlines.push({ id: "hub", label: "至少提前30分钟到站", afterStep: "route", at: at("10:05"), nature: "assumed", source: "演示" });
    expect(reverseCandidate(input)).toBe(at("08:55"));
    input.deadlines[1].at = at("09:35");
    expect(reverseCandidate(input)).toBe(at("08:30"));
    input.route.details.push({ label: "总耗时中的换乘重复展示", seconds: 900 });
    expect(reverseCandidate(input)).toBe(at("08:30"));
  });
  it("increased buffer advances recommendation by exactly the increase", () => {
    const input = standard(); input.buffers[0].seconds += 300;
    expect(reverseCandidate(input)).toBe(at("08:50"));
  });
  it("T11: 00:35 minus 100 minutes is previous-day 22:55, operating window still checked", async () => {
    const input = standard(); input.departureAt = at("00:35"); input.deadlines[0].at = at("00:30");
    const r = await resolveRedline(input, at("22:40", "2026-10-19"), "cross-day", fixedLookup);
    expect(r.suggestedAt).toBe(at("22:55", "2026-10-19"));
    expect(formatRedlineTime(r.suggestedAt, "2026-10-20")).toBe("前一天 2026-10-19 22:55");
    input.route.kind = "timed"; input.route.validFrom = at("06:00", "2026-10-19"); input.route.validUntil = at("22:00", "2026-10-19");
    const night = await resolveRedline(input, at("22:40", "2026-10-19"), "night", async () => ({ route: input.route }));
    expect(night.precision).toBe("pending_confirmation"); expect(night.suggestedCheck?.routeApplicable).toBe(false);
  });
  it.each([["09:00", "insufficient_margin", 300], ["09:06", "infeasible", -60], ["09:05", "infeasible", 0]] as const)("T12: %s gives %s", (now, status, slack) => {
    const check = forwardCheck(standard(), at(now), standard().route);
    expect(check.status).toBe(status); expect(check.deadlines[0].slackSeconds).toBe(slack);
  });
  it("has unique green/orange/red boundaries including exact zero", () => {
    const now = Date.parse(at("08:55"));
    expect(redlineUrgency(isoAt(now + 901000), now).color).toBe("green");
    expect(redlineUrgency(isoAt(now + 900000), now).color).toBe("orange");
    expect(redlineUrgency(isoAt(now + 1000), now).color).toBe("orange");
    expect(redlineUrgency(isoAt(now), now).color).toBe("red");
    expect(redlineUrgency(isoAt(now - 1000), now).color).toBe("red");
  });
  it("checks independent check-in, bag-drop, security and boarding deadlines", async () => {
    const input = standard(); input.route.durationSeconds = 1800;
    input.steps = [{ id: "checkin", label: "值机", seconds: 900, reason: "估算" }, { id: "bag", label: "托运", seconds: 900, reason: "估算" }, ...input.steps];
    input.deadlines = [
      { id: "checkin", label: "值机截止", at: at("09:00"), afterStep: "checkin", nature: "assumed", source: "独立假设" },
      { id: "bag", label: "托运截止", at: at("08:55"), afterStep: "bag", nature: "assumed", source: "独立假设" },
      { id: "security", label: "安检截止", at: at("09:25"), afterStep: "security", nature: "assumed", source: "独立假设" },
      { id: "boarding", label: "登机截止", at: at("09:45"), afterStep: "gate", nature: "assumed", source: "独立假设" },
    ];
    const r = await resolveRedline(input, at("07:30"), "air", fixedLookup);
    expect(r.suggestedAt).toBe(at("07:45"));
    expect(r.suggestedCheck?.deadlines.map((d) => d.status)).toEqual(["met", "met", "met", "met"]);
    input.deadlines[1].at = null; input.deadlines[1].nature = "unknown";
    const unknown = await resolveRedline(input, at("07:30"), "unknown", fixedLookup);
    expect(unknown.precision).toBe("pending_confirmation"); expect(unknown.suggestedCheck?.deadlines[1].status).toBe("unknown");
  });
  it("missing route or impossible preceding event never moves the ticket", async () => {
    const input = standard(); input.earliestDepartureAt = at("09:00");
    const r = await resolveRedline(input, at("08:00"), "conflict", fixedLookup);
    expect(r.conflicts).toHaveLength(1); expect(r.precision).toBe("pending_confirmation"); expect(input.departureAt).toBe(at("10:35"));
    input.route.durationSeconds = null;
    expect((await resolveRedline(input, at("08:00"), "missing", fixedLookup)).suggestedAt).toBeNull();
  });
});

function t28() {
  const input = standard(); input.id = "T28"; input.steps = [];
  input.deadlines = [{ id: "business", label: "业务截止", at: at("10:00"), afterStep: "route", nature: "confirmed", source: "同日演示业务截止" }];
  input.route = { ...input.route, kind: "timed", durationSeconds: 45 * 60, status: "verified", applicableAt: at("08:45"), validFrom: at("08:45"), validUntil: at("08:45"), futureCapability: true };
  return input;
}

describe("T28 departure-time validation and bounded lookup", () => {
  it("rejects 09:05 despite 08:45 being feasible; verifies 08:50 and every deadline", async () => {
    const input = t28();
    const departures = [at("09:00"), at("10:00")];
    const lookup = vi.fn(async (departureAt: string) => {
      const bus = departures.find((d) => Date.parse(d) >= Date.parse(departureAt) + 600000);
      const durationSeconds = bus ? (Date.parse(bus) + 1800000 - Date.parse(departureAt)) / 1000 : null;
      return { route: { ...input.route, durationSeconds, applicableAt: departureAt, validFrom: departureAt, validUntil: departureAt,
        status: bus ? "verified" : "unavailable" } as TimingRoute, nextCandidateAt: at("08:50") };
    });
    const r = await resolveRedline(input, at("08:45"), "T28", lookup);
    expect(r.attempts.map((a) => a.candidateAt)).toEqual([at("09:05"), at("08:50")]);
    expect(r.attempts[0].check.deadlines[0]).toMatchObject({ arrivalAt: at("10:30"), status: "missed" });
    expect(r.suggestedAt).toBe(at("08:50")); expect(r.suggestedCheck?.status).toBe("feasible");
    expect(r.currentCheck.departureAt).toBe(at("08:45")); expect(r.currentCheck.deadlines[0].arrivalAt).toBe(at("09:30"));
    expect(lookup.mock.calls.map(([time]) => time)).toEqual([at("09:05"), at("08:50"), at("08:45")]);
    expect(r.precision).toBe("verified");
    const dir = verificationEvidenceDirectory("phase15"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "T28-actual.json"), JSON.stringify({ fixture: "演示班次09:00/10:00；步行10分，乘车30分，截止10:00，缓冲10分", result: r }, null, 2));
  });
  it("can conservatively recheck an earlier candidate without claiming a global latest departure", async () => {
    const input = t28();
    const r = await resolveRedline(input, at("08:45"), "T28-conservative", async (departureAt) => {
      const bus = [at("09:00"), at("10:00")].find((d) => Date.parse(d) >= Date.parse(departureAt) + 600000)!;
      return { route: { ...input.route, durationSeconds: (Date.parse(bus) + 1800000 - Date.parse(departureAt)) / 1000,
        applicableAt: departureAt, validFrom: departureAt, validUntil: departureAt } };
    });
    expect(r.suggestedAt).toBe(at("08:25")); expect(r.suggestedCheck?.status).toBe("feasible"); expect(r.attempts).toHaveLength(2);
  });
  it("hard caps candidate lookups at three including the first; current check is separate", async () => {
    const input = t28(); let n = 0;
    const lookup = vi.fn(async () => ({ route: { ...input.route, validFrom: null, validUntil: null }, nextCandidateAt: at(`08:${40 - n++}`) }));
    const r = await resolveRedline(input, at("08:45"), "cap", lookup);
    expect(r.attempts).toHaveLength(3); expect(lookup).toHaveBeenCalledTimes(4);
    expect(r.precision).toBe("pending_confirmation"); expect(r.reason).toContain("3 轮");
    expect(r.suggestedAt).toBe(r.attempts[2].candidateAt);
  });
  it("cycles, missing future capability and failures degrade without false verification", async () => {
    const input = t28();
    const cycle = await resolveRedline(input, at("08:45"), "cycle", async (time) => ({ route: input.route, nextCandidateAt: time === at("09:05") ? at("08:30") : at("09:05") }));
    expect(cycle.attempts).toHaveLength(2); expect(cycle.reason).toContain("未收敛");
    const noFuture = await resolveRedline(input, at("08:45"), "no-future", async () => ({ route: { ...input.route, futureCapability: false } }));
    expect(noFuture.attempts).toHaveLength(1); expect(noFuture.precision).toBe("pending_confirmation");
    expect(noFuture.currentCheck.status).toBe("feasible"); expect(noFuture.suggestedCheck?.status).toBe("unknown");
    const failure = await resolveRedline(input, at("08:45"), "offline", async () => { throw new Error("offline"); });
    expect(failure.precision).toBe("pending_confirmation"); expect(failure.currentCheck.status).toBe("unknown");
  });
  it("full date and departure-time cache keys differ, including midnight and seconds", () => {
    clearRouteCache();
    const base = { mode: "public_transit" as const, provider: "test", from: { longitude: 113, latitude: 22 }, to: { longitude: 114, latitude: 23 } };
    const keys = [["2026-10-20", "08:45"], ["2026-10-20", "09:05"], ["2026-10-21", "08:45"], ["2026-10-20", "08:45:01"]].map(([date, departureTime]) => routeCacheKey({ ...base, date, departureTime }));
    expect(new Set(keys).size).toBe(4); expect(readCachedRoute(keys[1])).toBeNull();
  });
});
