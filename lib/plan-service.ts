import crypto from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  applyPlanCostEdit,
  CostEditValidationError,
  derivePlanCosts,
  planCostItemSchema,
  validatePlanCosts,
  type PlanCostEditInput,
  type PlanCostItem,
} from "./budget";
import { getDatabaseUrl } from "./data-directory";
import { evidenceFieldSchema } from "./evidence";
import { evidenceTarget, evidenceTargetSignature } from "./evidence-evaluation";
import {
  planEventSchema,
  planPendingItemSchema,
  planValidationResultsSchema,
  preparePlanForStorage,
  normalizePlanOutput,
  validatePlan,
  type PlanContent,
  type PlanCapture,
  type PlanEvent,
  type PlanPendingItem,
  type PlanValidationResults,
} from "./plan";
import {
  applyPlanEventEdit,
  planEventEditHasChanges,
  PlanEventFixedError,
  PlanEventLockedError,
  PlanEventEditValidationError,
  type PlanEventEditInput,
} from "./plan-edit";
import { requestSnapshotSchema, type RequestSnapshot } from "./trip-request";
import { placeSchema, placeIdentity, validatePlaceReferences, type Place, type PlaceCandidate } from "./places";
import { routeConflict, routeCostPricingUnit, routeLegSchema, routeModeLabels, type RouteLeg } from "./routes";

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

export class PlanConflictError extends Error {
  constructor(
    message = "行程状态已经变化，本次生成结果不能提交，请基于当前状态重试。",
  ) {
    super(message);
    this.name = "PlanConflictError";
  }
}

export class PlanNotFoundError extends Error {
  constructor() {
    super("没有找到这个计划版本。");
    this.name = "PlanNotFoundError";
  }
}

export type PlanVersionRecord = {
  id: string;
  tripId: string;
  versionNumber: number;
  requestRevision: number;
  requestSnapshot: RequestSnapshot;
  events: PlanEvent[];
  costs: PlanCostItem[];
  places: Place[];
  routeLegs: RouteLeg[];
  pendingItems: PlanPendingItem[];
  validationResults: PlanValidationResults;
  requirementUpToDate: boolean;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
};

type PlanVersionRow = Prisma.PlanVersionGetPayload<{
  include: { trip: { select: { currentPlanVersionId: true } } };
}>;

type PrismaGlobal = typeof globalThis & {
  serendipityPlanPrisma?: PrismaClient;
};

const prismaGlobal = globalThis as PrismaGlobal;
const prisma =
  prismaGlobal.serendipityPlanPrisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: getDatabaseUrl(),
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.serendipityPlanPrisma = prisma;
}

function parseSnapshot(value: string): RequestSnapshot {
  try {
    return requestSnapshotSchema.parse(JSON.parse(value));
  } catch {
    throw new PlanValidationError("已保存的需求快照无法读取。");
  }
}

function parseStoredCosts(value: string, events: PlanEvent[]): PlanCostItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PlanValidationError("计划费用数据无法读取。");
  }

  // 阶段09前创建的计划版本没有费用 JSON；读取时从事件草稿派生，保证旧计划可核算。
  if (Array.isArray(parsed) && parsed.length === 0) {
    return derivePlanCosts(events);
  }

  const result = z.array(planCostItemSchema).safeParse(parsed);
  if (!result.success) {
    throw new PlanValidationError("计划费用数据无法读取。");
  }
  return result.data;
}

function serializePlan(record: PlanVersionRow): PlanVersionRecord {
  try {
    const events = z.array(planEventSchema).parse(JSON.parse(record.events));
    const places = z.array(placeSchema).parse(JSON.parse(record.places));
    const routeLegs = z.array(routeLegSchema).parse(JSON.parse(record.routeLegs ?? "[]"));
    validatePlaceReferences(events, places);
    return {
      id: record.id,
      tripId: record.tripId,
      versionNumber: record.versionNumber,
      requestRevision: record.requestRevision,
      requestSnapshot: parseSnapshot(record.requestSnapshot),
      events,
      places,
      routeLegs,
      costs: parseStoredCosts(record.costs, events),
      pendingItems: z
        .array(planPendingItemSchema)
        .parse(JSON.parse(record.pendingItems)),
      validationResults: planValidationResultsSchema.parse(
        JSON.parse(record.validationResults),
      ),
      requirementUpToDate: record.requirementUpToDate,
      isCurrent: record.trip.currentPlanVersionId === record.id,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  } catch {
    throw new PlanValidationError("计划版本数据无法读取。");
  }
}

export async function listPlanVersions(tripId: string) {
  const rows = await prisma.planVersion.findMany({
    where: { tripId },
    include: { trip: { select: { currentPlanVersionId: true } } },
    orderBy: { versionNumber: "desc" },
  });
  return rows.map(serializePlan);
}

export async function getPlanVersion(
  tripId: string,
  versionNumber: number,
) {
  const row = await prisma.planVersion.findUnique({
    where: {
      tripId_versionNumber: { tripId, versionNumber },
    },
    include: { trip: { select: { currentPlanVersionId: true } } },
  });
  if (!row) {
    throw new PlanNotFoundError();
  }
  return serializePlan(row);
}

export async function getPlanGenerationContext(
  tripId: string,
  expectedRequestRevision: number,
): Promise<PlanCapture> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { request: true, currentPlanVersion: true },
  });
  if (!trip) {
    throw new PlanConflictError("没有找到这趟旅行。");
  }
  if (!trip.request) {
    throw new PlanConflictError("没有找到这趟旅行的需求记录。");
  }
  if (trip.request.requestRevision !== expectedRequestRevision) {
    throw new PlanConflictError(
      "需求已修改，请刷新后基于当前修订重新生成计划。",
    );
  }
  if (
    trip.request.confirmedRevision !== expectedRequestRevision ||
    !trip.request.confirmedRequest
  ) {
    throw new PlanConflictError("只有当前已确认的需求修订才能生成计划。");
  }
  assertRegenerationPreservesFacts(trip.currentPlanVersion);

  return {
    tripId,
    expectedRequestRevision,
    expectedPlanVersion: trip.currentPlanVersion?.versionNumber ?? null,
    requestSnapshot: parseSnapshot(trip.request.confirmedRequest),
    originalRequest: trip.request.originalRequest,
  };
}

function assertRegenerationPreservesFacts(current: { events: string; costs: string } | null) {
  if (!current) return;
  const events = z.array(planEventSchema).parse(JSON.parse(current.events));
  const costs = parseStoredCosts(current.costs, events);
  const protectedEvents = events.filter((event) => event.locked || event.status === "confirmed" || event.costStatus === "user_confirmed");
  const protectedCosts = costs.filter((cost) => cost.certainty === "user_confirmed" || cost.source === "user_confirmed" || cost.paymentStatus !== "not_paid");
  if (protectedEvents.length || protectedCosts.length || events.some((event) => event.placeId)) {
    throw new PlanConflictError(
      `当前计划包含锁定、已确认安排／地点或金额及支付事实。重新生成可能覆盖这些事实，已保留当前计划。请在日程、地图或预算中逐项修改；误锁定的安排可先解锁。`,
    );
  }
}

export async function savePlanVersion(input: {
  capture: PlanCapture;
  plan: PlanContent;
  validationResults: PlanValidationResults;
  abortSignal?: AbortSignal;
}) {
  if (input.abortSignal?.aborted) {
    throw new PlanConflictError("本次生成已取消，结果不会保存。");
  }
  if (input.validationResults.errors.length > 0) {
    throw new PlanValidationError(input.validationResults.errors[0]);
  }

  const { capture } = input;
  // Generations cross the model boundary; human edits use separate entry points.
  const plan = normalizePlanOutput(input.plan);
  const validation = validatePlan(plan, capture.requestSnapshot);
  if (validation.errors.length) throw new PlanValidationError(validation.errors[0]);
  const costs = derivePlanCosts(plan.events);
  const costErrors = validatePlanCosts(costs, plan.events);
  if (costErrors.length > 0) {
    throw new PlanValidationError(costErrors[0]);
  }
  try {
    return await prisma.$transaction(async (transaction) => {
      if (input.abortSignal?.aborted) {
        throw new PlanConflictError("本次生成已取消，结果不会保存。");
      }

      const trip = await transaction.trip.findUnique({
        where: { id: capture.tripId },
        include: { request: true, currentPlanVersion: true },
      });
      if (!trip?.request) {
        throw new PlanConflictError("没有找到这趟旅行或需求记录。");
      }
      if (
        trip.request.requestRevision !== capture.expectedRequestRevision ||
        trip.request.confirmedRevision !== capture.expectedRequestRevision ||
        !trip.request.confirmedRequest ||
        JSON.stringify(capture.requestSnapshot) !==
          trip.request.confirmedRequest
      ) {
        throw new PlanConflictError(
          "需求修订或确认状态已经变化，旧生成结果不能提交。",
        );
      }

      const currentPlanVersion = trip.currentPlanVersion?.versionNumber ?? null;
      if (currentPlanVersion !== capture.expectedPlanVersion) {
        throw new PlanConflictError(
          "当前计划版本已经变化，旧生成结果不能提交。",
        );
      }
      assertRegenerationPreservesFacts(trip.currentPlanVersion);

      const versionNumber = (capture.expectedPlanVersion ?? 0) + 1;
      const created = await transaction.planVersion.create({
        data: {
          tripId: trip.id,
          versionNumber,
          requestRevision: capture.expectedRequestRevision,
          requestSnapshot: JSON.stringify(capture.requestSnapshot),
          events: JSON.stringify(plan.events),
          costs: JSON.stringify(costs),
          routeLegs: "[]",
          pendingItems: JSON.stringify(plan.pendingItems),
          validationResults: JSON.stringify(validation),
          requirementUpToDate: true,
        },
      });

      await transaction.trip.update({
        where: { id: trip.id },
        data: {
          currentPlanVersionId: created.id,
          status:
            validation.warnings.length > 0
              ? "plan_needs_review"
              : "planned",
        },
      });

      const row = await transaction.planVersion.findUnique({
        where: { id: created.id },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!row) {
        throw new PlanConflictError();
      }
      return serializePlan(row);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new PlanConflictError(
        "当前计划版本已经变化，旧生成结果不能提交。",
      );
    }
    throw error;
  }
}

async function copyEvidenceFacts(
  transaction: Prisma.TransactionClient,
  sourcePlanVersionId: string,
  destinationPlanVersionId: string,
  source: { events: PlanEvent[]; costs: PlanCostItem[] },
  destination: { events: PlanEvent[]; costs: PlanCostItem[] },
) {
  const facts = await transaction.evidenceFact.findMany({
    where: { planVersionId: sourcePlanVersionId },
  });
  const copies = facts
    .filter((fact) => destination.events.some((event) => event.id === fact.targetId))
    .map((fact) => {
      const { id, createdAt, updatedAt, ...payload } = fact;
      void id;
      void createdAt;
      void updatedAt;
      const field = evidenceFieldSchema.safeParse(fact.field);
      const before = source.events.find((event) => event.id === fact.targetId);
      const after = destination.events.find((event) => event.id === fact.targetId)!;
      const targetChanged = !before || before.placeId !== after.placeId || !field.success ||
        evidenceTargetSignature(evidenceTarget(before, source.costs), field.data) !==
        evidenceTargetSignature(evidenceTarget(after, destination.costs), field.data);
      const needsReview = targetChanged || fact.lastRefreshStatus === "refreshing";
      return {
        ...payload,
        planVersionId: destinationPlanVersionId,
        ...(needsReview ? {
          lastRefreshStatus: "needs_review",
          lastRefreshError: null,
          conflictReason: [fact.conflictReason, targetChanged
            ? "当前安排或对应费用已变化，继承的来源必须重新核验。"
            : "创建本版本时旧来源仍在复核；旧请求的结果不适用于本版本，请重新核验。"].filter(Boolean).join(" "),
        } : {}),
      };
    });
  if (copies.length > 0) {
    await transaction.evidenceFact.createMany({ data: copies });
  }
}

export async function savePlanEventEdit(input: {
  tripId: string;
  expectedPlanVersion: number;
  edit: PlanEventEditInput;
}) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const row = await transaction.planVersion.findUnique({
        where: {
          tripId_versionNumber: {
            tripId: input.tripId,
            versionNumber: input.expectedPlanVersion,
          },
        },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!row) {
        throw new PlanNotFoundError();
      }
      if (row.trip.currentPlanVersionId !== row.id) {
        throw new PlanConflictError("只能编辑当前计划版本；历史版本保持只读。");
      }

      const currentPlan = serializePlan(row);
      const sourcePlan: PlanContent = {
        events: currentPlan.events,
        pendingItems: currentPlan.pendingItems,
      };
      if (!planEventEditHasChanges(sourcePlan, input.edit)) {
        throw new PlanValidationError("本次没有需要保存的修改。");
      }

      const editedPlan = preparePlanForStorage(
        applyPlanEventEdit(sourcePlan, input.edit),
      );
      const editedCosts = currentPlan.costs.map((cost) =>
        input.edit.remove && cost.linkedEventId === input.edit.eventId
          ? { ...cost, eventRemoved: true }
          : cost,
      );
      const costErrors = validatePlanCosts(editedCosts, editedPlan.events);
      if (costErrors.length > 0) {
        throw new PlanValidationError(costErrors[0]);
      }
      const validationResults = validatePlan(
        editedPlan,
        currentPlan.requestSnapshot,
      );
      if (validationResults.errors.length > 0) {
        throw new PlanValidationError(validationResults.errors[0]);
      }

      const created = await transaction.planVersion.create({
        data: {
          tripId: row.tripId,
          versionNumber: row.versionNumber + 1,
          requestRevision: row.requestRevision,
          requestSnapshot: row.requestSnapshot,
          events: JSON.stringify(editedPlan.events),
          costs: JSON.stringify(editedCosts),
          places: JSON.stringify(currentPlan.places.filter((place) => editedPlan.events.some((event) => event.placeId === place.id))),
          routeLegs: JSON.stringify(currentPlan.routeLegs.filter((leg) =>
            editedPlan.events.some((event) => event.id === leg.fromEventId) &&
            editedPlan.events.some((event) => event.id === leg.toEventId) &&
            (!input.edit.remove || (input.edit.eventId !== leg.fromEventId && input.edit.eventId !== leg.toEventId))
          ).map((leg) => input.edit.eventId === leg.fromEventId || input.edit.eventId === leg.toEventId
            ? { ...leg, status: "pending_confirmation" as const, scheduleBasis: `${leg.scheduleBasis}；日程时间或内容已修改，需按新时刻复核。` }
            : leg)),
          pendingItems: JSON.stringify(editedPlan.pendingItems),
          validationResults: JSON.stringify(validationResults),
          requirementUpToDate: row.requirementUpToDate,
        },
      });

      await copyEvidenceFacts(
        transaction,
        row.id,
        created.id,
        currentPlan,
        { events: editedPlan.events, costs: editedCosts },
      );

      await transaction.trip.update({
        where: { id: row.tripId },
        data: {
          currentPlanVersionId: created.id,
          status: !row.requirementUpToDate
            ? "plan_needs_update"
            : validationResults.warnings.length > 0
              ? "plan_needs_review"
              : "planned",
        },
      });

      const saved = await transaction.planVersion.findUnique({
        where: { id: created.id },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!saved) {
        throw new PlanConflictError();
      }
      return serializePlan(saved);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new PlanConflictError(
        "当前计划版本已经变化，本次编辑不能提交，请刷新后重试。",
      );
    }
    if (
      error instanceof PlanEventLockedError ||
      error instanceof PlanEventFixedError
    ) {
      throw new PlanConflictError(error.message);
    }
    if (error instanceof PlanEventEditValidationError) throw new PlanValidationError(error.message);
    throw error;
  }
}

export async function savePlanCostEdit(input: {
  tripId: string;
  expectedPlanVersion: number;
  edit: PlanCostEditInput;
}) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const row = await transaction.planVersion.findUnique({
        where: {
          tripId_versionNumber: {
            tripId: input.tripId,
            versionNumber: input.expectedPlanVersion,
          },
        },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!row) {
        throw new PlanNotFoundError();
      }
      if (row.trip.currentPlanVersionId !== row.id) {
        throw new PlanConflictError("只能编辑当前计划版本；历史版本保持只读。");
      }

      const currentPlan = serializePlan(row);
      let editedCosts: PlanCostItem[];
      try {
        editedCosts = applyPlanCostEdit(currentPlan.costs, input.edit);
      } catch (error) {
        if (error instanceof CostEditValidationError) {
          throw new PlanValidationError(error.message);
        }
        throw error;
      }
      const costErrors = validatePlanCosts(
        editedCosts,
        currentPlan.events,
      );
      if (costErrors.length > 0) {
        throw new PlanValidationError(costErrors[0]);
      }

      const sourcePlan: PlanContent = preparePlanForStorage({
        events: currentPlan.events,
        pendingItems: currentPlan.pendingItems,
      });
      const validationResults = validatePlan(
        sourcePlan,
        currentPlan.requestSnapshot,
      );
      if (validationResults.errors.length > 0) {
        throw new PlanValidationError(validationResults.errors[0]);
      }

      const created = await transaction.planVersion.create({
        data: {
          tripId: row.tripId,
          versionNumber: row.versionNumber + 1,
          requestRevision: row.requestRevision,
          requestSnapshot: row.requestSnapshot,
          events: JSON.stringify(sourcePlan.events),
          costs: JSON.stringify(editedCosts),
          places: JSON.stringify(currentPlan.places),
          routeLegs: JSON.stringify(currentPlan.routeLegs),
          pendingItems: row.pendingItems,
          validationResults: JSON.stringify(validationResults),
          requirementUpToDate: row.requirementUpToDate,
        },
      });

      await copyEvidenceFacts(
        transaction,
        row.id,
        created.id,
        currentPlan,
        { events: sourcePlan.events, costs: editedCosts },
      );

      await transaction.trip.update({
        where: { id: row.tripId },
        data: {
          currentPlanVersionId: created.id,
          status: !row.requirementUpToDate
            ? "plan_needs_update"
            : validationResults.warnings.length > 0
              ? "plan_needs_review"
              : "planned",
        },
      });

      const saved = await transaction.planVersion.findUnique({
        where: { id: created.id },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!saved) {
        throw new PlanConflictError();
      }
      return serializePlan(saved);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new PlanConflictError(
        "当前计划版本已经变化，本次费用修改不能提交，请刷新后重试。",
      );
    }
    throw error;
  }
}

export async function savePlanPlaceEdit(input: {
  tripId: string; expectedPlanVersion: number; eventId: string;
  candidate: PlaceCandidate | null; precision: Place["precision"];
  abortSignal?: AbortSignal;
}) {
  try {
    return await prisma.$transaction(async (transaction) => {
      if (input.abortSignal?.aborted) throw new PlanConflictError("本次定位已取消。");
      const row = await transaction.planVersion.findUnique({
        where: { tripId_versionNumber: { tripId: input.tripId, versionNumber: input.expectedPlanVersion } },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!row) throw new PlanNotFoundError();
      if (row.trip.currentPlanVersionId !== row.id) throw new PlanConflictError("计划版本已变化，请刷新后重新搜索；历史版本保持只读。");
      const current = serializePlan(row);
      const event = current.events.find((item) => item.id === input.eventId);
      if (!event) throw new PlanValidationError("没有找到对应日程。");
      if (event.locked || event.status === "confirmed") throw new PlanConflictError("这项安排已锁定或确认，请先在时间轴解除后再修改地点。");
      const candidate = input.candidate;
      const precision = input.precision;
      const place = candidate ? placeSchema.parse({ ...candidate,
        id: placeIdentity(candidate, precision), precision, confirmation: "user_confirmed",
        confirmedAt: new Date().toISOString(), source: candidate.provider === "amap" ? "高德地图地点搜索" : "OpenStreetMap / Nominatim",
      }) : null;
      if ((event.placeId ?? null) === (place?.id ?? null)) throw new PlanValidationError("这项安排的地点没有变化。");
      const events = current.events.map((item) => item.id === event.id ? {
        ...item, placeId: place?.id ?? null,
        locationName: place ? `${place.name.slice(0, 150)}${place.precision === "area_reference" ? "（区域参考点）" : ""}` : item.locationName,
      } : item);
      const places = current.places.filter((item) => events.some((event) => event.placeId === item.id));
      if (place && !places.some((item) => item.id === place.id)) places.push(place);
      validatePlaceReferences(events, places);
      const created = await transaction.planVersion.create({ data: {
        tripId: row.tripId, versionNumber: row.versionNumber + 1,
        requestRevision: row.requestRevision, requestSnapshot: row.requestSnapshot,
        events: JSON.stringify(events), places: JSON.stringify(places), costs: row.costs,
        routeLegs: JSON.stringify(current.routeLegs.filter((leg) => leg.fromEventId !== event.id && leg.toEventId !== event.id)),
        pendingItems: row.pendingItems, validationResults: row.validationResults,
        requirementUpToDate: row.requirementUpToDate,
      } });
      await copyEvidenceFacts(transaction, row.id, created.id, current, { events, costs: current.costs });
      if (input.abortSignal?.aborted) throw new PlanConflictError("本次定位已取消。");
      await transaction.trip.update({ where: { id: row.tripId }, data: { currentPlanVersionId: created.id } });
      const saved = await transaction.planVersion.findUnique({ where: { id: created.id }, include: { trip: { select: { currentPlanVersionId: true } } } });
      if (!saved) throw new PlanConflictError();
      return serializePlan(saved);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new PlanConflictError("计划已变化，请刷新后重试。");
    throw error;
  }
}

function routeCostId(fromEventId: string, toEventId: string) {
  return `route-${crypto.createHash("sha256").update(`${fromEventId}\n${toEventId}`).digest("hex").slice(0, 24)}`;
}

export function applyRouteCost(route: RouteLeg, events: PlanEvent[], costs: PlanCostItem[]): PlanCostItem[] {
  const id = routeCostId(route.fromEventId, route.toEventId);
  const from = events.find((event) => event.id === route.fromEventId);
  const to = events.find((event) => event.id === route.toEventId);
  const base = costs.filter((cost) => cost.id !== id);
  if (
    route.mode === "walking" ||
    route.status === "unavailable" ||
    from?.type === "local_transport" ||
    to?.type === "local_transport"
  ) return base;

  const existing = costs.find((cost) => cost.id === id);
  if (existing && (existing.source === "user_confirmed" || existing.paymentStatus !== "not_paid")) return base;
  const amountKnown = route.cost.minCents !== null;
  return [...base, planCostItemSchema.parse({
    id,
    linkedEventId: route.toEventId,
    category: "local_transport",
    currency: "CNY",
    unit: routeCostPricingUnit(route.mode),
    unitAmountCents: route.cost.minCents,
    unitAmountMaxCents: route.cost.maxCents,
    quantity: null,
    certainty: amountKnown && route.status !== "pending_confirmation" ? "estimated" : "pending_confirmation",
    paymentStatus: "not_paid",
    source: "ai_draft",
    eventRemoved: false,
    note: `${routeModeLabels[route.mode]}：${route.cost.basis}`,
  })];
}

export async function savePlanRouteEdit(input: {
  tripId: string;
  expectedPlanVersion: number;
  route: RouteLeg;
  abortSignal?: AbortSignal;
}) {
  try {
    return await prisma.$transaction(async (transaction) => {
      if (input.abortSignal?.aborted) throw new PlanConflictError("本次路线查询已取消。");
      const row = await transaction.planVersion.findUnique({
        where: { tripId_versionNumber: { tripId: input.tripId, versionNumber: input.expectedPlanVersion } },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!row) throw new PlanNotFoundError();
      if (row.trip.currentPlanVersionId !== row.id) throw new PlanConflictError("计划已变化，请刷新后重新查询路线；历史版本保持只读。");
      const current = serializePlan(row);
      const from = current.events.find((event) => event.id === input.route.fromEventId);
      const to = current.events.find((event) => event.id === input.route.toEventId);
      if (!from || !to) throw new PlanValidationError("路线关联的日程不存在，请刷新后重试。");
      if (from.date !== input.route.date || to.date !== input.route.date) throw new PlanValidationError("城市路线只能连接同一天的两个地点。");
      if (from.endTime > input.route.departureTime) throw new PlanValidationError("出发时刻不能早于上一项结束时间。");

      const route = { ...input.route, conflict: routeConflict({
        route: input.route,
        earliestDate: to.date,
        earliestStartTime: to.startTime,
      }) };
      const routeLegs = [
        ...current.routeLegs.filter((leg) => leg.fromEventId !== route.fromEventId || leg.toEventId !== route.toEventId),
        routeLegSchema.parse(route),
      ];
      const costs = applyRouteCost(routeLegSchema.parse(route), current.events, current.costs);
      const costErrors = validatePlanCosts(costs, current.events);
      if (costErrors.length > 0) throw new PlanValidationError(costErrors[0]);

      const created = await transaction.planVersion.create({ data: {
        tripId: row.tripId,
        versionNumber: row.versionNumber + 1,
        requestRevision: row.requestRevision,
        requestSnapshot: row.requestSnapshot,
        events: row.events,
        costs: JSON.stringify(costs),
        places: row.places,
        routeLegs: JSON.stringify(routeLegs),
        pendingItems: row.pendingItems,
        validationResults: row.validationResults,
        requirementUpToDate: row.requirementUpToDate,
      } });
      if (input.abortSignal?.aborted) throw new PlanConflictError("本次路线查询已取消。");
      await copyEvidenceFacts(transaction, row.id, created.id, current, { events: current.events, costs });
      await transaction.trip.update({ where: { id: row.tripId }, data: { currentPlanVersionId: created.id } });
      const saved = await transaction.planVersion.findUnique({ where: { id: created.id }, include: { trip: { select: { currentPlanVersionId: true } } } });
      if (!saved) throw new PlanConflictError();
      return serializePlan(saved);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new PlanConflictError("计划已变化，请刷新后重试。");
    throw error;
  }
}

export async function markCurrentPlanStale(
  transaction: Prisma.TransactionClient,
  tripId: string,
) {
  const trip = await transaction.trip.findUnique({
    where: { id: tripId },
    select: { currentPlanVersionId: true },
  });
  if (!trip) {
    return;
  }

  await transaction.planVersion.updateMany({
    where: { tripId, requirementUpToDate: true },
    data: { requirementUpToDate: false },
  });
  await transaction.trip.update({
    where: { id: tripId },
    data: {
      status: trip.currentPlanVersionId
        ? "plan_needs_update"
        : "requirement_pending",
    },
  });
}

export async function closePlanStore() {
  await prisma.$disconnect();
}
