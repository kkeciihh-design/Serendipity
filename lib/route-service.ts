import crypto from "node:crypto";
import { z } from "zod";
import { getMapConfiguration } from "./map-settings";
import { getSettingsRecord } from "./settings";
import { getPlanVersion, PlanConflictError, PlanValidationError, savePlanRouteEdit } from "./plan-service";
import { toGcj02, toWgs84 } from "./places";
import {
  arrivalForRoute,
  manualReferenceRoute,
  manualRouteEditSchema,
  parseAmapRoute,
  parseOsmRoute,
  queryRouteWithCandidateRecheck,
  readCachedRoute,
  routeLegSchema,
  routeCacheKey,
  routeModeSchema,
  writeCachedRoute,
  type RouteCandidateRecheck,
  type RouteLeg,
  type RouteMode,
} from "./routes";
import { planEventEnd, sortPlanEvents, type PlanEvent } from "./plan";

export const routeQuerySchema = z.object({
  fromEventId: z.string().min(1).max(80),
  toEventId: z.string().min(1).max(80),
  mode: routeModeSchema,
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});

export class RouteServiceError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
    this.name = "RouteServiceError";
  }
}

export async function fetchRouteJson(url: URL, signal?: AbortSignal) {
  const allowed = url.protocol === "https:" &&
    ["routing.openstreetmap.de", "restapi.amap.com"].includes(url.hostname) &&
    !url.port && !url.username && !url.password;
  if (!allowed) throw new RouteServiceError("路线请求地址不受支持。", 400);
  const timeout = AbortSignal.timeout(15_000);
  try {
    const response = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok || !response.body) throw new RouteServiceError("路线服务暂时不可用，请稍后重试。");
    const maxBytes = 2_000_000;
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body.cancel();
      throw new RouteServiceError("路线响应过大，请缩小范围后重试。");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new RouteServiceError("路线响应过大，请缩小范围后重试。");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof RouteServiceError) throw error;
    throw new RouteServiceError(timeout.aborted ? "路线查询超时，请重试。" : "路线服务连接失败，请检查网络后重试。");
  }
}

function assertAdjacentRoutePair(dayEvents: PlanEvent[], from: PlanEvent, to: PlanEvent) {
  if (from.date !== to.date) throw new PlanValidationError("城市路线只能连接同一天的两个地点。");
  const placed = sortPlanEvents(dayEvents).filter((event) => event.placeId);
  const fromIndex = placed.findIndex((event) => event.id === from.id);
  const toIndex = placed.findIndex((event) => event.id === to.id);
  if (fromIndex === -1 || toIndex !== fromIndex + 1) {
    throw new PlanValidationError("只能按日程顺序查询当天相邻两个已确认地点的路线。");
  }
}

function unavailableRoute(input: {
  id: string;
  fromEventId: string;
  toEventId: string;
  date: string;
  departureTime: string;
  mode: RouteMode;
  scheduleBasis: string;
  source: string;
  cacheKey: string;
  futureQueryCapability: boolean;
}): RouteLeg {
  const candidateRecheck: RouteCandidateRecheck = {
    attempts: 1,
    status: "not_applicable",
    requestedDepartureTime: input.departureTime,
    finalDepartureTime: input.departureTime,
    reason: "没有可用公共交通路线，未执行候选时刻复核。",
  };
  return {
    id: input.id,
    fromEventId: input.fromEventId,
    toEventId: input.toEventId,
    date: input.date,
    departureTime: input.departureTime,
    validFromTime: input.departureTime,
    validUntilTime: input.departureTime,
    arrivalDate: null,
    arrivalTime: null,
    mode: input.mode,
    status: "unavailable",
    distanceMeters: null,
    durationSeconds: null,
    includedTimes: [],
    polyline: [],
    coordinateSystem: "WGS84",
    steps: [],
    futureQueryCapability: input.futureQueryCapability,
    candidateRecheck,
    scheduleBasis: input.scheduleBasis,
    cost: { minCents: null, maxCents: null, basis: "无可用路线，费用未知", source: input.source },
    cacheKey: input.cacheKey,
    source: input.source,
    retrievedAt: new Date().toISOString(),
    conflict: null,
  };
}

function routeIdentity(input: {
  tripId: string;
  fromEventId: string;
  toEventId: string;
  date: string;
  departureTime: string;
  mode: RouteMode;
  cacheKey: string;
}) {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 48);
}

export async function searchAndSavePlanRoute(tripId: string, version: number, input: unknown, signal?: AbortSignal) {
  const parsed = routeQuerySchema.safeParse(input);
  if (!parsed.success) throw new PlanValidationError(parsed.error.issues[0]?.message ?? "路线查询格式不正确。");
  const plan = await getPlanVersion(tripId, version);
  if (!plan.isCurrent) throw new PlanConflictError("计划已变化，请刷新后重新查询路线。");
  const from = plan.events.find((event) => event.id === parsed.data.fromEventId);
  const to = plan.events.find((event) => event.id === parsed.data.toEventId);
  if (!from || !to) throw new PlanValidationError("没有找到路线连接的两个地点。");
  assertAdjacentRoutePair(plan.events.filter((event) => event.date === from.date), from, to);
  const fromPlace = plan.places.find((place) => place.id === from.placeId);
  const toPlace = plan.places.find((place) => place.id === to.placeId);
  if (!fromPlace || !toPlace) throw new PlanValidationError("两个安排都必须先确认地点。");
  const departureTime = parsed.data.departureTime ?? from.endTime;
  if (planEventEnd(from).getTime() > Date.parse(`${from.date}T${departureTime}:00+08:00`)) throw new PlanValidationError("出发时刻不能早于上一项结束时间。");

  const mode = parsed.data.mode;
  const settings = await getSettingsRecord();
  const provider = settings.mapProvider;
  const cacheKey = routeCacheKey({
    date: from.date,
    departureTime,
    mode,
    provider,
    from: { longitude: fromPlace.longitude, latitude: fromPlace.latitude },
    to: { longitude: toPlace.longitude, latitude: toPlace.latitude },
  });
  const id = routeIdentity({ tripId, fromEventId: from.id, toEventId: to.id, date: from.date, departureTime, mode, cacheKey });
  const cached = readCachedRoute(cacheKey);
  if (cached && cached.fromEventId === from.id && cached.toEventId === to.id) {
    return savePlanRouteEdit({ tripId, expectedPlanVersion: version, route: cached, abortSignal: signal });
  }

  const common = { id, fromEventId: from.id, toEventId: to.id, date: from.date, departureTime, mode, cacheKey };
  let route: RouteLeg;
  if (provider === "amap") {
    const configuration = await getMapConfiguration();
    const fromCoordinate = toGcj02(fromPlace, fromPlace.coordinateSystem);
    const toCoordinate = toGcj02(toPlace, toPlace.coordinateSystem);
    const url = new URL(mode === "public_transit"
      ? "https://restapi.amap.com/v3/direction/transit/integrated"
      : `https://restapi.amap.com/v3/direction/${mode === "walking" ? "walking" : "driving"}`);
    url.search = new URLSearchParams({
      key: configuration.webServiceKey,
      origin: `${fromCoordinate.longitude.toFixed(6)},${fromCoordinate.latitude.toFixed(6)}`,
      destination: `${toCoordinate.longitude.toFixed(6)},${toCoordinate.latitude.toFixed(6)}`,
      extensions: "all",
      output: "JSON",
      ...(mode === "public_transit" ? { city: fromPlace.city, cityd: toPlace.city, date: from.date, time: departureTime, strategy: "0" } : {}),
    }).toString();
    const result = await queryRouteWithCandidateRecheck(async () => {
      const payload = await fetchRouteJson(url, signal);
      const parsedRoute = parseAmapRoute(payload, mode);
      const arrival = arrivalForRoute(from.date, departureTime, parsedRoute.durationSeconds);
      return {
        route: {
          ...common,
          validFromTime: departureTime,
          validUntilTime: departureTime,
          arrivalDate: parsedRoute.available ? arrival.date : null,
          arrivalTime: parsedRoute.available ? arrival.time : null,
          status: !parsedRoute.available ? "unavailable" : mode === "public_transit" ? "pending_confirmation" : mode === "driving" ? "estimated" : "verified",
          distanceMeters: parsedRoute.available ? parsedRoute.distanceMeters : null,
          durationSeconds: parsedRoute.available ? parsedRoute.durationSeconds : null,
          includedTimes: parsedRoute.includedTimes,
          polyline: parsedRoute.polyline,
          coordinateSystem: "GCJ-02",
          steps: parsedRoute.steps,
          futureQueryCapability: false,
          candidateRecheck: {
            attempts: 1,
            status: "converged",
            requestedDepartureTime: departureTime,
            finalDepartureTime: departureTime,
            reason: "首轮查询已返回适用出发时刻的路线。",
          },
          scheduleBasis: parsedRoute.scheduleBasis,
          cost: parsedRoute.cost,
          source: "高德路径规划 Web 服务",
          retrievedAt: new Date().toISOString(),
          conflict: null,
        } satisfies RouteLeg,
        needsCandidateRecheck: false,
      };
    }, departureTime);
    route = result.route;
  } else if (mode === "public_transit") {
    route = unavailableRoute({
      ...common,
      scheduleBasis: "当前免费地图方案没有公共交通路线服务；未虚构班次、耗时或票价。",
      source: "免费地图方案能力限制",
      futureQueryCapability: false,
    });
  } else {
    const fromCoordinate = toWgs84(fromPlace, fromPlace.coordinateSystem);
    const toCoordinate = toWgs84(toPlace, toPlace.coordinateSystem);
    const url = new URL(`https://routing.openstreetmap.de/routed-${mode === "walking" ? "foot" : "car"}/route/v1/driving/${fromCoordinate.longitude},${fromCoordinate.latitude};${toCoordinate.longitude},${toCoordinate.latitude}`);
    url.search = new URLSearchParams({ overview: "full", geometries: "polyline", steps: "true" }).toString();
    const payload = await fetchRouteJson(url, signal);
    const parsedRoute = parseOsmRoute(payload);
    const arrival = arrivalForRoute(from.date, departureTime, parsedRoute.durationSeconds);
    route = {
      ...common,
      validFromTime: departureTime,
      validUntilTime: departureTime,
      arrivalDate: arrival.date,
      arrivalTime: arrival.time,
      status: mode === "walking" ? "verified" : "estimated",
      distanceMeters: parsedRoute.distanceMeters,
      durationSeconds: parsedRoute.durationSeconds,
      includedTimes: mode === "walking" ? ["walking"] : ["driving"],
      polyline: parsedRoute.polyline,
      coordinateSystem: "WGS84",
      steps: parsedRoute.steps,
      futureQueryCapability: false,
      candidateRecheck: {
        attempts: 1,
        status: "not_applicable",
        requestedDepartureTime: departureTime,
        finalDepartureTime: departureTime,
        reason: "步行/驾车道路查询不依赖班次候选，结果仅绑定本次出发时刻。",
      },
      scheduleBasis: mode === "walking"
        ? "按指定出发时刻查询的步行道路；耗时来自路线服务，未包含异常等待。"
        : "按指定出发时刻查询的驾车道路；未包含叫车等候、实时路况和停车时间。",
      cost: mode === "walking"
        ? { minCents: 0, maxCents: 0, basis: "步行无车费", source: "规则估算" }
        : { minCents: null, maxCents: null, basis: "OSRM 未返回打车计价费用；等候、起步价和堵车需另行确认", source: "OpenStreetMap / OSRM" },
      cacheKey,
      source: "OpenStreetMap / OSRM",
      retrievedAt: new Date().toISOString(),
      conflict: null,
    };
  }
  route = routeLegSchema.parse(route);
  if (signal?.aborted) throw new PlanConflictError("本次路线查询已取消。");
  writeCachedRoute(cacheKey, route);
  return savePlanRouteEdit({ tripId, expectedPlanVersion: version, route, abortSignal: signal });
}

export async function saveManualPlanRoute(tripId: string, version: number, input: unknown, signal?: AbortSignal) {
  const parsed = manualRouteEditSchema.safeParse(input);
  if (!parsed.success) throw new PlanValidationError(parsed.error.issues[0]?.message ?? "人工路线记录格式不正确。");
  const plan = await getPlanVersion(tripId, version);
  if (!plan.isCurrent) throw new PlanConflictError("计划已变化，请刷新后重新记录路线。");
  const from = plan.events.find((event) => event.id === parsed.data.fromEventId);
  const to = plan.events.find((event) => event.id === parsed.data.toEventId);
  if (!from || !to) throw new PlanValidationError("没有找到路线连接的两个地点。");
  assertAdjacentRoutePair(plan.events.filter((event) => event.date === from.date), from, to);
  if (!plan.places.some((place) => place.id === from.placeId) || !plan.places.some((place) => place.id === to.placeId)) {
    throw new PlanValidationError("两个安排都必须先确认地点。");
  }
  if (planEventEnd(from).getTime() > Date.parse(`${from.date}T${parsed.data.departureTime}:00+08:00`)) {
    throw new PlanValidationError("出发时刻不能早于上一项结束时间。");
  }
  const route = manualReferenceRoute({ tripId, date: from.date, edit: parsed.data });
  return savePlanRouteEdit({ tripId, expectedPlanVersion: version, route, abortSignal: signal });
}
