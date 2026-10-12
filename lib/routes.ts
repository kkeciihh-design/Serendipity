import crypto from "node:crypto";
import { z } from "zod";
import { coordinateSchema, type Coordinate } from "./places";

export const routeModeSchema = z.enum(["walking", "public_transit", "driving"]);
export type RouteMode = z.infer<typeof routeModeSchema>;

export const routeStatusSchema = z.enum([
  "verified",
  "estimated",
  "pending_confirmation",
  "unavailable",
]);
export type RouteStatus = z.infer<typeof routeStatusSchema>;

const routeDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const routeTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const routeStepSchema = z.object({
  instruction: z.string().trim().min(1).max(240),
  distanceMeters: z.number().int().min(0).nullable(),
  durationSeconds: z.number().int().min(0).nullable(),
  line: z.string().trim().max(120).nullable(),
  vehicle: z.string().trim().max(80).nullable(),
  departureTime: routeTime.nullable(),
  arrivalTime: routeTime.nullable(),
});
export type RouteStep = z.infer<typeof routeStepSchema>;

export const routeCostSchema = z.object({
  minCents: z.number().int().min(0).nullable(),
  maxCents: z.number().int().min(0).nullable(),
  basis: z.string().trim().max(240),
  source: z.string().trim().max(160),
});
export type RouteCost = z.infer<typeof routeCostSchema>;

export const routeCandidateRecheckSchema = z.object({
  attempts: z.number().int().min(1).max(3),
  status: z.enum(["not_applicable", "converged", "not_converged"]),
  requestedDepartureTime: routeTime,
  finalDepartureTime: routeTime,
  reason: z.string().trim().max(240),
});
export type RouteCandidateRecheck = z.infer<typeof routeCandidateRecheckSchema>;

export const routeLegSchema = z.object({
  id: z.string().trim().min(1).max(180),
  fromEventId: z.string().trim().min(1).max(80),
  toEventId: z.string().trim().min(1).max(80),
  date: routeDate,
  departureTime: routeTime,
  validFromTime: routeTime,
  validUntilTime: routeTime,
  arrivalDate: routeDate,
  arrivalTime: routeTime,
  mode: routeModeSchema,
  status: routeStatusSchema,
  distanceMeters: z.number().int().min(0),
  durationSeconds: z.number().int().min(1).max(86_400),
  includedTimes: z.array(z.enum(["walking", "waiting", "transfer", "driving", "riding"])).max(8),
  polyline: z.array(coordinateSchema).max(2_000),
  coordinateSystem: z.enum(["WGS84", "GCJ-02"]),
  steps: z.array(routeStepSchema).max(100),
  futureQueryCapability: z.boolean(),
  candidateRecheck: routeCandidateRecheckSchema,
  scheduleBasis: z.string().trim().max(240),
  cost: routeCostSchema,
  cacheKey: z.string().trim().min(16).max(128),
  source: z.string().trim().max(160),
  retrievedAt: z.iso.datetime(),
  conflict: z.string().trim().max(240).nullable(),
});
export type RouteLeg = z.infer<typeof routeLegSchema>;

export type RouteQueryResult = {
  route: RouteLeg;
  needsCandidateRecheck: boolean;
  nextCandidateTime?: string;
};

const cacheState = globalThis as typeof globalThis & {
  serendipityRouteCache?: Map<string, { expiresAt: number; route: RouteLeg }>;
};
const routeCache = cacheState.serendipityRouteCache ?? new Map();
cacheState.serendipityRouteCache = routeCache;

export function routeCacheKey(input: {
  date: string;
  departureTime: string;
  mode: RouteMode;
  from: Coordinate;
  to: Coordinate;
}) {
  const identity = JSON.stringify({
    date: input.date,
    departureTime: input.departureTime,
    mode: input.mode,
    from: {
      longitude: Number(input.from.longitude.toFixed(6)),
      latitude: Number(input.from.latitude.toFixed(6)),
    },
    to: {
      longitude: Number(input.to.longitude.toFixed(6)),
      latitude: Number(input.to.latitude.toFixed(6)),
    },
  });
  return crypto.createHash("sha256").update(identity).digest("hex").slice(0, 64);
}

export function readCachedRoute(key: string, now = Date.now()) {
  const cached = routeCache.get(key);
  if (!cached || cached.expiresAt <= now) {
    routeCache.delete(key);
    return null;
  }
  return cached.route;
}

export function writeCachedRoute(key: string, route: RouteLeg, ttlMs = 15 * 60 * 1000) {
  routeCache.set(key, { expiresAt: Date.now() + ttlMs, route });
  return route;
}

export function clearRouteCache() {
  routeCache.clear();
}

export const routeModeLabels: Record<RouteMode, string> = {
  walking: "步行",
  public_transit: "地铁/公交",
  driving: "驾车/打车",
};

export const routeStatusLabels: Record<RouteStatus, string> = {
  verified: "已核实",
  estimated: "估算",
  pending_confirmation: "待确认",
  unavailable: "暂无可用路线",
};

export function routeCostPricingUnit(mode: RouteMode) {
  return mode === "public_transit" ? "per_person" as const : "one_time" as const;
}

export function formatRouteDuration(seconds: number) {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

export function formatRouteDistance(meters: number) {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(meters >= 10_000 ? 0 : 1)} 公里` : `${meters} 米`;
}

export function arrivalForRoute(date: string, departureTime: string, durationSeconds: number) {
  const start = Date.parse(`${date}T${departureTime}:00+08:00`);
  const local = new Date(start + durationSeconds * 1000 + 8 * 60 * 60 * 1000);
  return { date: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 16) };
}

export function scheduledTransitTiming(input: {
  departureTime: string;
  walkingMinutes: number;
  ridingMinutes: number;
  departures: string[];
}) {
  const minutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  const departure = minutes(input.departureTime);
  const atStation = departure + input.walkingMinutes;
  const nextDeparture = input.departures.map(minutes).find((time) => time >= atStation);
  if (nextDeparture === undefined) return null;
  const waitingMinutes = nextDeparture - atStation;
  const arrival = nextDeparture + input.ridingMinutes;
  return {
    waitingMinutes,
    arrivalMinutes: arrival,
    totalMinutes: arrival - departure,
    arrivalTime: `${String(Math.floor(arrival / 60)).padStart(2, "0")}:${String(arrival % 60).padStart(2, "0")}`,
  };
}

export function routeConflict(input: {
  route: Pick<RouteLeg, "date" | "arrivalDate" | "departureTime" | "arrivalTime">;
  earliestDate: string;
  earliestStartTime: string;
}) {
  return input.route.arrivalDate !== input.earliestDate || input.route.arrivalTime > input.earliestStartTime
    ? `按 ${input.route.departureTime} 出发预计 ${input.route.arrivalDate} ${input.route.arrivalTime} 到达，晚于下一项 ${input.earliestDate} ${input.earliestStartTime} 开始。`
    : null;
}

export const MAX_ROUTE_RECHECK_ROUNDS = 3;

export async function queryRouteWithCandidateRecheck(
  query: (departureTime: string, round: number) => Promise<RouteQueryResult>,
  departureTime: string,
) {
  let current = departureTime;
  let rounds = 1;
  let result = await query(current, 1);
  for (let round = 2; round <= MAX_ROUTE_RECHECK_ROUNDS && result.needsCandidateRecheck && result.nextCandidateTime; round += 1) {
    current = result.nextCandidateTime;
    rounds = round;
    result = await query(current, round);
  }
  if (result.needsCandidateRecheck) {
    return {
      ...result,
      route: {
        ...result.route,
        status: "pending_confirmation" as const,
        candidateRecheck: {
          attempts: MAX_ROUTE_RECHECK_ROUNDS,
          status: "not_converged" as const,
          requestedDepartureTime: departureTime,
          finalDepartureTime: current,
          reason: "3 轮候选时刻复核后仍未收敛，结果待确认。",
        },
        scheduleBasis: `${result.route.scheduleBasis}；已完成 ${MAX_ROUTE_RECHECK_ROUNDS} 轮候选时刻复核仍未收敛，结果待确认。`,
      },
    };
  }
  return {
    ...result,
    route: {
      ...result.route,
      candidateRecheck: {
        attempts: rounds,
        status: "converged" as const,
        requestedDepartureTime: departureTime,
        finalDepartureTime: current,
        reason: rounds === 1
          ? "首轮查询已返回适用出发时刻的路线。"
          : `第 ${rounds} 轮候选时刻复核后适用。`,
      },
    },
  };
}

function decodePolyline(encoded: string, precision = 5): Coordinate[] {
  const coordinates: Coordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    for (const key of ["lat", "lng"] as const) {
      let result = 1;
      let shift = 0;
      let bit;
      do {
        bit = encoded.charCodeAt(index++) - 63 - 1;
        result += bit << shift;
        shift += 5;
      } while (bit >= 31);
      if (result & 1) result = ~result;
      const delta = result >> 1;
      if (key === "lat") latitude += delta;
      else longitude += delta;
    }
    coordinates.push({
      latitude: latitude / 10 ** precision,
      longitude: longitude / 10 ** precision,
    });
  }
  return coordinates;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function parseOsmRoute(payload: unknown): {
  distanceMeters: number;
  durationSeconds: number;
  polyline: Coordinate[];
  steps: RouteStep[];
} {
  if (!payload || typeof payload !== "object" || (payload as { code?: unknown }).code !== "Ok") {
    throw new Error("路线服务没有返回可用道路。");
  }
  const route = (payload as { routes?: unknown[] }).routes?.[0];
  if (!route || typeof route !== "object") throw new Error("路线服务返回缺少路线。");
  const record = route as {
    distance?: unknown;
    duration?: unknown;
    geometry?: unknown;
    legs?: unknown[];
  };
  const distanceMeters = Math.round(Number(record.distance));
  const durationSeconds = Math.round(Number(record.duration));
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("路线服务返回的距离或耗时不可用。");
  }
  const polyline = decodePolyline(text(record.geometry));
  if (polyline.length < 2) throw new Error("路线服务没有返回路径折线。");
  const rawSteps = (record.legs ?? []).flatMap((leg) =>
    leg && typeof leg === "object" ? (leg as { steps?: unknown[] }).steps ?? [] : [],
  );
  const steps: RouteStep[] = [];
  for (const rawStep of rawSteps.slice(0, 100)) {
    if (!rawStep || typeof rawStep !== "object") continue;
    const step = rawStep as {
      name?: unknown;
      maneuver?: { type?: unknown; modifier?: unknown };
      distance?: unknown;
      duration?: unknown;
    };
    const road = text(step.name);
    const maneuver = text(step.maneuver?.type) || "continue";
    const modifier = text(step.maneuver?.modifier);
    const instruction = `${maneuver === "depart" ? "出发" : maneuver === "arrive" ? "到达" : modifier || "沿道路"}${road ? `：${road}` : ""}`;
    const parsed = routeStepSchema.safeParse({
      instruction,
      distanceMeters: Math.round(Number(step.distance ?? 0)),
      durationSeconds: Math.round(Number(step.duration ?? 0)),
      line: null,
      vehicle: null,
      departureTime: null,
      arrivalTime: null,
    });
    if (parsed.success) steps.push(parsed.data);
  }
  if (!steps.length) throw new Error("路线服务没有返回可展示步骤。");
  return { distanceMeters, durationSeconds, polyline, steps };
}

function parseAmapPolyline(value: unknown): Coordinate[] {
  const coordinates = text(value)
    .split(";")
    .map((part) => part.split(",").map(Number))
    .filter((pair) => pair.length === 2 && pair.every((item) => Number.isFinite(item)))
    .map(([longitude, latitude]) => ({ longitude, latitude }));
  return coordinates.map((coordinate) => coordinateSchema.parse(coordinate));
}

function parseAmapSteps(mode: RouteMode, transit: unknown): RouteStep[] {
  const steps: RouteStep[] = [];
  if (mode !== "public_transit") {
    const paths = (transit as { paths?: unknown[] })?.paths ?? [];
    for (const path of paths) {
      for (const raw of (path as { steps?: unknown[] })?.steps ?? []) {
        if (!raw || typeof raw !== "object") continue;
        const step = raw as {
          instruction?: unknown;
          road?: unknown;
          distance?: unknown;
          duration?: unknown;
        };
        const parsed = routeStepSchema.safeParse({
          instruction: text(step.instruction) || (text(step.road) ? `沿${text(step.road)}` : "沿道路前进"),
          distanceMeters: Math.round(Number(step.distance ?? 0)),
          durationSeconds: Math.round(Number(step.duration ?? 0)),
          line: null,
          vehicle: null,
          departureTime: null,
          arrivalTime: null,
        });
        if (parsed.success) steps.push(parsed.data);
      }
    }
    return steps;
  }

  const segments = (transit as { segments?: unknown[] })?.segments ?? [];
  for (const segment of segments) {
    if (!segment || typeof segment !== "object") continue;
    const walking = (segment as { walking?: { distance?: unknown; duration?: unknown; steps?: unknown[] } }).walking;
    if (walking) {
      const duration = Math.round(Number(walking.duration ?? 0));
      const parsed = routeStepSchema.safeParse({
        instruction: duration ? `步行约 ${Math.round(duration / 60)} 分钟` : "步行",
        distanceMeters: Math.round(Number(walking.distance ?? 0)),
        durationSeconds: duration,
        line: null,
        vehicle: null,
        departureTime: null,
        arrivalTime: null,
      });
      if (parsed.success) steps.push(parsed.data);
    }
    const buslines = (segment as { bus?: { buslines?: unknown[] } }).bus?.buslines ?? [];
    for (const raw of buslines) {
      if (!raw || typeof raw !== "object") continue;
      const busline = raw as {
        name?: unknown;
        type?: unknown;
        departure_stop?: { name?: unknown };
        arrival_stop?: { name?: unknown };
        departure_time?: unknown;
        arrival_time?: unknown;
        duration?: unknown;
      };
      const from = text(busline.departure_stop?.name);
      const to = text(busline.arrival_stop?.name);
      const parsed = routeStepSchema.safeParse({
        instruction: `${text(busline.name)}：${from || "上车"} → ${to || "下车"}`,
        distanceMeters: null,
        durationSeconds: Math.round(Number(busline.duration ?? 0)),
        line: text(busline.name),
        vehicle: text(busline.type) || "公交/地铁",
        departureTime: /^\d{2}:\d{2}$/.test(text(busline.departure_time)) ? text(busline.departure_time) : null,
        arrivalTime: /^\d{2}:\d{2}$/.test(text(busline.arrival_time)) ? text(busline.arrival_time) : null,
      });
      if (parsed.success) steps.push(parsed.data);
    }
  }
  return steps;
}

function parseAmapTransitPolyline(transit: unknown): Coordinate[] {
  const segments = (transit as { segments?: unknown[] })?.segments ?? [];
  return segments.flatMap((segment) => {
    const buslines = (segment as { bus?: { buslines?: unknown[] } }).bus?.buslines ?? [];
    return buslines.flatMap((busline) => parseAmapPolyline((busline as { polyline?: unknown }).polyline));
  });
}

export function parseAmapRoute(payload: unknown, mode: RouteMode): {
  available: boolean;
  distanceMeters: number;
  durationSeconds: number;
  polyline: Coordinate[];
  steps: RouteStep[];
  cost: RouteCost;
  includedTimes: RouteLeg["includedTimes"];
  scheduleBasis: string;
} {
  if (!payload || typeof payload !== "object" || text((payload as { status?: unknown }).status) !== "1") {
    throw new Error("高德路线查询失败，请检查地图服务配置。");
  }
  const route = (payload as { route?: Record<string, unknown> }).route;
  if (!route || typeof route !== "object") throw new Error("高德路线返回格式异常。");
  if (mode === "public_transit") {
    const transit = (route as { transits?: unknown[] }).transits?.[0] ??
      (route as { transit_path?: unknown }).transit_path;
    const durationValue = Number((transit as { duration?: unknown } | undefined)?.duration);
    const distanceValue = Number((transit as { walking_distance?: unknown; distance?: unknown } | undefined)?.walking_distance ??
      (transit as { distance?: unknown } | undefined)?.distance);
    const costValue = Number((transit as { cost?: unknown } | undefined)?.cost);
    const steps = parseAmapSteps("public_transit", transit);
    const polyline = parseAmapTransitPolyline(transit);
    return {
      available: steps.length > 0 && Number.isFinite(durationValue) && durationValue > 0,
      distanceMeters: Number.isFinite(distanceValue) ? Math.round(distanceValue) : 0,
      durationSeconds: Number.isFinite(durationValue) ? Math.round(durationValue) : 0,
      polyline,
      steps,
      cost: {
        minCents: Number.isFinite(costValue) ? Math.round(costValue * 100) : null,
        maxCents: Number.isFinite(costValue) ? Math.round(costValue * 100) : null,
        basis: Number.isFinite(costValue) ? "高德公交方案票价" : "公共交通票价未知",
        source: "高德路径规划 Web 服务",
      },
      includedTimes: ["walking", "waiting", "riding", "transfer"],
      scheduleBasis: "按完整出行日期和指定出发时刻查询的公共交通方案；耗时含步行、候车、乘车和换乘。",
    };
  }

  const path = (route as { paths?: unknown[] }).paths?.[0];
  if (!path || typeof path !== "object") throw new Error("高德没有返回步行或驾车路线。");
  const record = path as {
    distance?: unknown;
    duration?: unknown;
    steps?: unknown[];
    tolls?: unknown;
  };
  const polyline = (record.steps ?? []).flatMap((step) =>
    parseAmapPolyline((step as { polyline?: unknown }).polyline),
  );
  const tolls = Number(record.tolls ?? 0);
  return {
    available: polyline.length > 1,
    distanceMeters: Math.round(Number(record.distance ?? 0)),
    durationSeconds: Math.round(Number(record.duration ?? 0)),
    polyline,
    steps: parseAmapSteps(mode, { paths: [record] }),
    cost: mode === "walking"
      ? { minCents: 0, maxCents: 0, basis: "步行无车费", source: "规则估算" }
      : {
          minCents: Number.isFinite(tolls) && tolls > 0 ? Math.round(tolls * 100) : null,
          maxCents: Number.isFinite(tolls) && tolls > 0 ? Math.round(tolls * 100) : null,
          basis: "驾车道路耗时来自高德；打车等候和计价费用未知，需另行确认",
          source: "高德路径规划 Web 服务",
        },
    includedTimes: mode === "walking" ? ["walking"] : ["driving"],
    scheduleBasis: mode === "walking"
      ? "按指定出发时刻查询的步行道路；耗时受实际路况影响较小。"
      : "按指定出发时刻查询的驾车道路；未包含叫车等候、实时路况和停车时间。",
  };
}
