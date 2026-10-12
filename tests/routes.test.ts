import { describe, expect, it } from "vitest";
import {
  arrivalForRoute,
  clearRouteCache,
  formatRouteDistance,
  parseAmapRoute,
  parseOsmRoute,
  queryRouteWithCandidateRecheck,
  readCachedRoute,
  routeCostPricingUnit,
  routeCacheKey,
  routeConflict,
  scheduledTransitTiming,
  writeCachedRoute,
  type RouteLeg,
} from "../lib/routes";

const coordinate = { longitude: 114.06, latitude: 22.54 };

function route(overrides: Partial<RouteLeg> = {}): RouteLeg {
  return {
    id: "route",
    fromEventId: "from",
    toEventId: "to",
    date: "2026-10-12",
    departureTime: "08:45",
    validFromTime: "08:45",
    validUntilTime: "08:45",
    arrivalDate: "2026-10-12",
    arrivalTime: "09:30",
    mode: "public_transit",
    status: "verified",
    distanceMeters: 3_000,
    durationSeconds: 2_700,
    includedTimes: ["walking", "waiting", "riding", "transfer"],
    polyline: [coordinate, { longitude: 114.07, latitude: 22.55 }],
    coordinateSystem: "WGS84",
    steps: [],
    futureQueryCapability: true,
    candidateRecheck: {
      attempts: 1,
      status: "converged",
      requestedDepartureTime: "08:45",
      finalDepartureTime: "08:45",
      reason: "测试",
    },
    scheduleBasis: "班次资料",
    cost: { minCents: 300, maxCents: 500, basis: "公交票价", source: "测试班次" },
    cacheKey: "cache-key",
    source: "测试班次",
    retrievedAt: "2026-10-11T01:00:00.000Z",
    conflict: null,
    ...overrides,
  };
}

describe("city routes", () => {
  it("keeps route cache isolated by full date and departure time", () => {
    clearRouteCache();
    const input = { date: "2026-10-12", mode: "public_transit" as const, from: coordinate, to: { longitude: 114.11, latitude: 22.53 } };
    const first = routeCacheKey({ ...input, departureTime: "08:45" });
    const second = routeCacheKey({ ...input, departureTime: "09:05" });
    const sameFirst = routeCacheKey({ ...input, departureTime: "08:45" });
    expect(second).not.toBe(first);
    expect(sameFirst).toBe(first);

    const firstRoute = route({ id: first, cacheKey: first, arrivalTime: "09:30", durationSeconds: 2_700 });
    writeCachedRoute(first, firstRoute);
    expect(readCachedRoute(second)).toBeNull();
    expect(readCachedRoute(first)?.arrivalTime).toBe("09:30");
  });

  it("computes the T28 schedule differently for adjacent departure times", () => {
    const early = scheduledTransitTiming({ departureTime: "08:45", walkingMinutes: 10, ridingMinutes: 30, departures: ["09:00", "10:00"] });
    const late = scheduledTransitTiming({ departureTime: "09:05", walkingMinutes: 10, ridingMinutes: 30, departures: ["09:00", "10:00"] });
    expect(early).toEqual({ waitingMinutes: 5, arrivalMinutes: 570, totalMinutes: 45, arrivalTime: "09:30" });
    expect(late).toEqual({ waitingMinutes: 45, arrivalMinutes: 630, totalMinutes: 85, arrivalTime: "10:30" });
    expect(early?.totalMinutes).not.toBe(late?.totalMinutes);
  });

  it("returns no scheduled transit result after the last departure", () => {
    expect(scheduledTransitTiming({
      departureTime: "23:50",
      walkingMinutes: 10,
      ridingMinutes: 30,
      departures: ["23:00"],
    })).toBeNull();
  });

  it("uses per-person pricing for transit and one-car pricing for driving", () => {
    expect(routeCostPricingUnit("public_transit")).toBe("per_person");
    expect(routeCostPricingUnit("driving")).toBe("one_time");
    expect(routeCostPricingUnit("walking")).toBe("one_time");
  });

  it("bounds candidate rechecks to three rounds and degrades clearly", async () => {
    let calls = 0;
    const result = await queryRouteWithCandidateRecheck(async (departureTime, round) => {
      calls += 1;
      return {
        route: route({ departureTime, status: "verified", scheduleBasis: `第 ${round} 轮` }),
        needsCandidateRecheck: true,
        nextCandidateTime: "09:05",
      };
    }, "08:45");
    expect(calls).toBe(3);
    expect(result.route.status).toBe("pending_confirmation");
    expect(result.route.candidateRecheck).toMatchObject({
      attempts: 3,
      status: "not_converged",
      requestedDepartureTime: "08:45",
      finalDepartureTime: "09:05",
    });
    expect(result.route.scheduleBasis).toContain("3 轮");
  });

  it("parses OSRM road data without turning failures into straight lines", () => {
    const parsed = parseOsmRoute({
      code: "Ok",
      routes: [{
        distance: 1234,
        duration: 567,
        geometry: "ygqhC_jdwT@lE",
        legs: [{ steps: [{ name: "Example Road", maneuver: { type: "depart" }, distance: 100, duration: 60 }] }],
      }],
    });
    expect(parsed.distanceMeters).toBe(1234);
    expect(parsed.durationSeconds).toBe(567);
    expect(parsed.polyline.length).toBeGreaterThan(1);
    expect(parsed.steps[0].instruction).toContain("出发");
    expect(() => parseOsmRoute({ code: "NoRoute", routes: [] })).toThrow("路线服务没有返回可用道路。");
  });

  it("parses Amap walking and scheduled transit payloads", () => {
    const walking = parseAmapRoute({
      status: "1",
      route: { paths: [{ distance: 1000, duration: 600, steps: [{ instruction: "沿和平路步行", distance: 1000, duration: 600, polyline: "114.06,22.54;114.07,22.55" }] }] },
    }, "walking");
    expect(walking.available).toBe(true);
    expect(walking.distanceMeters).toBe(1000);
    expect(walking.cost.minCents).toBe(0);
    expect(walking.polyline).toHaveLength(2);

    const transit = parseAmapRoute({
      status: "1",
      route: { transits: [{
        duration: 2700,
        walking_distance: 600,
        cost: 3,
        segments: [
          { walking: { distance: 600, duration: 600, steps: [] }, bus: { buslines: [{
            name: "地铁1号线", type: "地铁", departure_stop: { name: "罗湖" }, arrival_stop: { name: "会展中心" },
            duration: 1800, departure_time: "09:00", arrival_time: "09:30", polyline: "114.06,22.54;114.07,22.55",
          }] } },
        ],
      }] },
    }, "public_transit");
    expect(transit.available).toBe(true);
    expect(transit.durationSeconds).toBe(2700);
    expect(transit.cost.minCents).toBe(300);
    expect(transit.steps.map((step) => step.instruction)).toEqual([
      "步行约 10 分钟",
      "地铁1号线：罗湖 → 会展中心",
    ]);
    expect(transit.polyline).toHaveLength(2);
    expect(transit.includedTimes).toEqual(["walking", "waiting", "riding", "transfer"]);
  });

  it("formats arrival and detects schedule conflicts without double counting", () => {
    expect(arrivalForRoute("2026-10-12", "08:45", 2_700)).toEqual({ date: "2026-10-12", time: "09:30" });
    expect(formatRouteDistance(1_234)).toBe("1.2 公里");
    const conflict = routeConflict({
      route: route({ arrivalTime: "09:30" }),
      earliestDate: "2026-10-12",
      earliestStartTime: "09:00",
    });
    expect(conflict).toContain("晚于");
    expect(routeConflict({ route: route({ arrivalTime: "09:00" }), earliestDate: "2026-10-12", earliestStartTime: "09:00" })).toBeNull();
  });
});
