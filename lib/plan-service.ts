import crypto from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  applyPlanCostEdit,
  CostEditValidationError,
  budgetWarnings,
  budgetFactorsFromSnapshot,
  costItemLineTotals,
  derivePlanCosts,
  formatMoneyRange,
  hasProtectedCostFact,
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
  planEventEnd,
  sortPlanEvents,
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
import { invalidateRouteReference, routeConflict, routeCostPricingUnit, routeLegSchema, routeModeLabels, type RouteLeg } from "./routes";
import {
  activeTicketCoreSchema,
  activateTicket,
  applyTicketsToEvents,
  cancelTicket,
  createDraftTicket,
  isActiveTicket,
  replaceTicket,
  ticketActionSchema,
  ticketChangedEventIds,
  ticketSchema,
  updateTicketDetails,
  validateTickets,
  type Ticket,
  type TicketAction,
} from "./tickets";

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
  tickets: Ticket[];
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

function parseStoredTickets(value: string | null | undefined): Ticket[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? "[]");
  } catch {
    throw new PlanValidationError("计划票据数据无法读取。");
  }
  const result = z.array(ticketSchema).safeParse(parsed);
  if (!result.success) {
    throw new PlanValidationError("计划票据数据无法读取。");
  }
  return result.data;
}

function validationWithTickets(
  validation: PlanValidationResults,
  tickets: Ticket[],
  events: PlanEvent[],
): PlanValidationResults {
  const ticketValidation = validateTickets(tickets, events);
  const errors = [...validation.errors, ...ticketValidation.errors];
  const warnings = [...validation.warnings, ...ticketValidation.warnings];
  return {
    ...validation,
    errors,
    warnings,
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "needs_review" : "valid",
  };
}

function serializePlan(record: PlanVersionRow): PlanVersionRecord {
  try {
    const events = z.array(planEventSchema).parse(JSON.parse(record.events));
    const places = z.array(placeSchema).parse(JSON.parse(record.places));
    const routeLegs = z.array(routeLegSchema).parse(JSON.parse(record.routeLegs ?? "[]"));
    const tickets = parseStoredTickets(record.tickets);
    const isCurrent = record.trip.currentPlanVersionId === record.id;
    const costs = parseStoredCosts(record.costs, events).filter((cost) =>
      !isCurrent || !cost.eventRemoved || hasProtectedCostFact(cost),
    );
    const requestSnapshot = parseSnapshot(record.requestSnapshot);
    const storedValidation = planValidationResultsSchema.parse(JSON.parse(record.validationResults));
    // Derived display metadata may be refreshed without rewriting historical
    // snapshots. Preserve any non-budget findings from the stored validation.
    const warnings = [
      ...storedValidation.warnings.filter((warning) => !/^(当前费用(?:草稿合计|合计|区间)|确认预算非常低)/.test(warning)),
      ...budgetWarnings(costs, requestSnapshot),
    ];
    const validationResults: PlanValidationResults = {
      ...storedValidation,
      warnings,
      status: storedValidation.errors.length > 0 ? "invalid" : warnings.length > 0 ? "needs_review" : "valid",
    };
    validatePlaceReferences(events, places);
    return {
      id: record.id,
      tripId: record.tripId,
      versionNumber: record.versionNumber,
      requestRevision: record.requestRevision,
      requestSnapshot,
      events,
      places,
      routeLegs,
      tickets,
      costs,
      pendingItems: z
        .array(planPendingItemSchema)
        .parse(JSON.parse(record.pendingItems)),
      validationResults,
      requirementUpToDate: record.requirementUpToDate,
      isCurrent,
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

function assertRegenerationPreservesFacts(current: { events: string; costs: string; tickets?: string } | null) {
  if (!current) return;
  const events = z.array(planEventSchema).parse(JSON.parse(current.events));
  const costs = parseStoredCosts(current.costs, events);
  const protectedEvents = events.filter((event) => event.locked || event.status === "confirmed" || event.costStatus === "user_confirmed");
  const protectedCosts = costs.filter((cost) => cost.certainty === "user_confirmed" || cost.source === "user_confirmed" || cost.paymentStatus !== "not_paid");
  if (protectedEvents.length || protectedCosts.length || events.some((event) => event.placeId) || parseStoredTickets(current.tickets).some((ticket) => ticket.confirmedAt)) {
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
      const inheritedTickets = parseStoredTickets(trip.currentPlanVersion?.tickets)
        .filter((ticket) => plan.events.some((event) => event.id === ticket.eventId));
      const created = await transaction.planVersion.create({
        data: {
          tripId: trip.id,
          versionNumber,
          requestRevision: capture.expectedRequestRevision,
          requestSnapshot: JSON.stringify(capture.requestSnapshot),
          events: JSON.stringify(plan.events),
          costs: JSON.stringify(costs),
          routeLegs: "[]",
          tickets: JSON.stringify(inheritedTickets),
          pendingItems: JSON.stringify(plan.pendingItems),
          validationResults: JSON.stringify(validationWithTickets(validation, inheritedTickets, plan.events)),
          requirementUpToDate: true,
        },
      });

      await transaction.trip.update({
        where: { id: trip.id },
        data: {
          currentPlanVersionId: created.id,
          status:
            validationWithTickets(validation, inheritedTickets, plan.events).warnings.length > 0
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
      if (currentPlan.tickets.some((ticket) => isActiveTicket(ticket) && ticket.eventId === input.edit.eventId)) {
        throw new PlanConflictError("这项交通受当前有效票约束，请通过票面入口记录真实退票或替换；不能直接解锁或改动票面时刻。");
      }
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
      const initialEditedCosts = currentPlan.costs.filter((cost) =>
        !input.edit.remove || cost.linkedEventId !== input.edit.eventId || hasProtectedCostFact(cost),
      ).map((cost) =>
        input.edit.remove && cost.linkedEventId === input.edit.eventId
          ? { ...cost, eventRemoved: true }
          : cost,
      );
      const { routeLegs: editedRoutes, costs: editedCosts } = updateRoutesAfterEventChange(
        currentPlan.routeLegs, editedPlan.events, initialEditedCosts, input.edit.eventId,
        currentPlan.events,
      );
      const costErrors = validatePlanCosts(editedCosts, editedPlan.events);
      if (costErrors.length > 0) {
        throw new PlanValidationError(costErrors[0]);
      }
      const validationResults = validationWithTickets(validatePlan(
        editedPlan,
        currentPlan.requestSnapshot,
        editedCosts,
      ), currentPlan.tickets, editedPlan.events);
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
          routeLegs: JSON.stringify(editedRoutes),
          tickets: JSON.stringify(currentPlan.tickets),
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
        editedCosts = applyPlanCostEdit(currentPlan.costs, input.edit, currentPlan.events);
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
      const validationResults = validationWithTickets(validatePlan(
        sourcePlan,
        currentPlan.requestSnapshot,
        editedCosts,
      ), currentPlan.tickets, sourcePlan.events);
      // A ticket can reveal an existing timing conflict. Money already paid
      // or refunded remains recordable while that schedule is being repaired.

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
          tickets: JSON.stringify(currentPlan.tickets),
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
            : validationResults.errors.length > 0 || validationResults.warnings.length > 0
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
      const { routeLegs, costs } = updateRoutesAfterEventChange(current.routeLegs, events, current.costs, event.id, current.events);
      const costErrors = validatePlanCosts(costs, events);
      if (costErrors.length > 0) throw new PlanValidationError(costErrors[0]);
      const validationResults = validationWithTickets(
        validatePlan({ events, pendingItems: current.pendingItems }, current.requestSnapshot, costs),
        current.tickets,
        events,
      );
      if (validationResults.errors.length > 0) throw new PlanValidationError(validationResults.errors[0]);
      const created = await transaction.planVersion.create({ data: {
        tripId: row.tripId, versionNumber: row.versionNumber + 1,
        requestRevision: row.requestRevision, requestSnapshot: row.requestSnapshot,
        events: JSON.stringify(events), places: JSON.stringify(places), costs: JSON.stringify(costs),
        routeLegs: JSON.stringify(routeLegs),
        tickets: JSON.stringify(current.tickets),
        pendingItems: row.pendingItems, validationResults: JSON.stringify(validationResults),
        requirementUpToDate: row.requirementUpToDate,
      } });
      await copyEvidenceFacts(transaction, row.id, created.id, current, { events, costs });
      if (input.abortSignal?.aborted) throw new PlanConflictError("本次定位已取消。");
      await transaction.trip.update({ where: { id: row.tripId }, data: {
        currentPlanVersionId: created.id,
        status: !row.requirementUpToDate ? "plan_needs_update" : validationResults.warnings.length > 0 ? "plan_needs_review" : "planned",
      } });
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

function routeTransportEventIds(route: RouteLeg, events: PlanEvent[]) {
  const ordered = sortPlanEvents(events.filter((event) => event.date === route.date));
  const fromIndex = ordered.findIndex((event) => event.id === route.fromEventId);
  const toIndex = ordered.findIndex((event) => event.id === route.toEventId);
  return fromIndex >= 0 && toIndex >= fromIndex
    ? ordered.slice(fromIndex, toIndex + 1).filter((event) => event.type === "local_transport").map((event) => event.id)
    : [];
}

function protectedRouteCostNote(cost: PlanCostItem, route: RouteLeg, possibleDuplicate = false) {
  const unit = routeCostPricingUnit(route.mode);
  if (!possibleDuplicate && cost.unit === unit && cost.unitAmountCents === route.cost.minCents &&
    (cost.unitAmountMaxCents ?? cost.unitAmountCents) === (route.cost.maxCents ?? route.cost.minCents)) return cost;
  const reference = route.status === "unavailable" ? "无可用路线" :
    `${formatMoneyRange(route.cost.minCents, route.cost.maxCents)}${unit === "per_person" ? "/人（全程含换乘）" : "/全程"}`;
  return {
    ...cost,
    note: `${(cost.note ?? "").replace(/；(?:路线参考核对：|该段另有已确认).*$/, "").slice(0, 100)}；路线参考核对：${reference}；${possibleDuplicate ? "该段另有确认或付款记录，可能重复；" : ""}原确认或付款金额保留，请核对差额及计价口径。`.slice(0, 240),
  };
}

export function applyRouteCost(route: RouteLeg, events: PlanEvent[], costs: PlanCostItem[]): PlanCostItem[] {
  const id = routeCostId(route.fromEventId, route.toEventId);
  const existing = costs.find((cost) => cost.id === id);
  const currentTransportIds = new Set(routeTransportEventIds(route, events));
  const transportEventIds = new Set([...(route.transportEventIds ?? []), ...currentTransportIds]);
  // The saved association also covers removed/moved transport events. A
  // schedule edit cannot turn the same old reference into a second purchase.
  // Only current segment estimates can be replaced. A moved event's new
  // unknown expense must not be swallowed by its former route association.
  const transportCosts = costs.filter((cost) => !cost.id.startsWith("route-") &&
    ((cost.transferSide === "access" && cost.linkedEventId === route.toEventId) ||
      (cost.transferSide === "egress" && cost.linkedEventId === route.fromEventId) ||
      (hasProtectedCostFact(cost) ? transportEventIds.has(cost.linkedEventId) : currentTransportIds.has(cost.linkedEventId))));
  const protectedTransport = transportCosts.filter(hasProtectedCostFact);
  const draftIds = new Set(transportCosts.filter((cost) => !hasProtectedCostFact(cost)).map((cost) => cost.id));
  if (existing && hasProtectedCostFact(existing)) {
    return costs.filter((cost) => !draftIds.has(cost.id)).map((cost) => cost.id === id
      ? protectedRouteCostNote(cost, route, protectedTransport.length > 0) : cost);
  }
  const base = costs.filter((cost) => cost.id !== id && !draftIds.has(cost.id)).map((cost) =>
    protectedTransport.some((fact) => fact.id === cost.id) ? protectedRouteCostNote(cost, route) : cost,
  );
  const unresolvedRemainder = protectedTransport.length > 0 && events.some((event) =>
    currentTransportIds.has(event.id) && !protectedTransport.some((cost) => cost.linkedEventId === event.id),
  );
  if (protectedTransport.length > 0 && !unresolvedRemainder) return base;
  if (!unresolvedRemainder && (route.mode === "walking" || route.status === "unavailable")) return base;

  // The route fare is a whole-journey price, even if it includes several
  // transfers. Replace all pure estimates once and use the route's unit.
  // Partial paid records cannot safely be subtracted from that price, so the
  // unconfirmed remainder stays unknown instead of counting the full fare twice.
  const amountKnown = !unresolvedRemainder && route.cost.minCents !== null;
  return [...base, planCostItemSchema.parse({
    id,
    linkedEventId: route.toEventId,
    category: "local_transport",
    currency: "CNY",
    unit: routeCostPricingUnit(route.mode),
    unitAmountCents: unresolvedRemainder ? null : route.cost.minCents,
    unitAmountMaxCents: unresolvedRemainder ? null : route.cost.maxCents,
    quantity: null,
    certainty: amountKnown && route.status !== "pending_confirmation" ? "estimated" : "pending_confirmation",
    paymentStatus: "not_paid",
    source: "ai_draft",
    eventRemoved: false,
    note: unresolvedRemainder
      ? "该段已有部分确认或付款记录；全程参考票价不能再次全部计入，剩余费用需核对。"
      : `${routeModeLabels[route.mode]}：${route.cost.basis}；该路段全程票价只计一次，包含关联交通及换乘。`.slice(0, 240),
  })];
}

function adjacentRoutePair(events: PlanEvent[], fromEventId: string, toEventId: string) {
  const from = events.find((event) => event.id === fromEventId);
  const to = events.find((event) => event.id === toEventId);
  if (!from || !to || from.date !== to.date) return false;
  const placed = sortPlanEvents(events.filter((event) => event.date === from.date && event.placeId));
  const index = placed.findIndex((event) => event.id === from.id);
  return index >= 0 && placed[index + 1]?.id === to.id;
}

function routeRelevantEventChanged(before: PlanEvent | undefined, after: PlanEvent, endpoint: "from" | "to") {
  return !before || before.date !== after.date ||
    (endpoint === "from" ? planEventEnd(before).getTime() !== planEventEnd(after).getTime() : before.startTime !== after.startTime) ||
    before.placeId !== after.placeId || before.locationName !== after.locationName || before.type !== after.type;
}

function routeTransportChanged(before: PlanEvent | undefined, after: PlanEvent | undefined) {
  return !before || !after || before.date !== after.date || before.startTime !== after.startTime ||
    planEventEnd(before).getTime() !== planEventEnd(after).getTime() || before.type !== after.type ||
    before.placeId !== after.placeId || before.locationName !== after.locationName;
}

function restoreReleasedTransportCosts(
  previousRoutes: RouteLeg[], currentRoutes: RouteLeg[], events: PlanEvent[],
  costs: PlanCostItem[], previousEvents = events,
) {
  const previouslyCovered = new Set(previousRoutes.flatMap((route) => route.transportEventIds ?? routeTransportEventIds(route, previousEvents)));
  const currentlyCovered = new Set(currentRoutes.filter((route) => adjacentRoutePair(events, route.fromEventId, route.toEventId))
    .flatMap((route) => routeTransportEventIds(route, events)));
  const restored = events.filter((event) => event.type === "local_transport" && previouslyCovered.has(event.id) &&
    !currentlyCovered.has(event.id) && !costs.some((cost) => cost.linkedEventId === event.id && !cost.id.startsWith("route-")))
    .map((event) => ({
      ...derivePlanCosts([event])[0], unitAmountCents: null, certainty: "pending_confirmation" as const,
      note: "原路线已不再覆盖这项交通安排，费用需重新确认。",
    }));
  return restored.length > 0 ? [...costs, ...restored] : costs;
}

export function updateRoutesAfterEventChange(routeLegs: RouteLeg[], events: PlanEvent[], originalCosts: PlanCostItem[], changedEventId: string, previousEvents?: PlanEvent[]) {
  let costs = originalCosts;
  const routes: RouteLeg[] = [];
  for (const leg of routeLegs) {
    const oldTransportIds = leg.transportEventIds ?? routeTransportEventIds(leg, previousEvents ?? events);
    const currentTransportIds = routeTransportEventIds(leg, events);
    const associated = { ...leg, transportEventIds: [...new Set([...oldTransportIds, ...currentTransportIds])] };
    const from = events.find((event) => event.id === leg.fromEventId);
    const to = events.find((event) => event.id === leg.toEventId);
    if (!from || !to || !adjacentRoutePair(events, leg.fromEventId, leg.toEventId)) {
      const id = routeCostId(leg.fromEventId, leg.toEventId);
      costs = costs.filter((cost) => cost.id !== id || hasProtectedCostFact(cost))
        .map((cost) => cost.id === id ? { ...cost, note: `${(cost.note ?? "").slice(0, 170)}；原路线已不再适用，保留已确认或已支付金额，请在预算中核对。` } : cost);
      continue;
    }
    const changedEndpoint = changedEventId === from.id ? from : changedEventId === to.id ? to : undefined;
    const endpointChanged = changedEndpoint && (!previousEvents || routeRelevantEventChanged(previousEvents.find((event) => event.id === changedEndpoint.id), changedEndpoint, changedEndpoint.id === from.id ? "from" : "to"));
    const transportChanged = associated.transportEventIds.includes(changedEventId) && (
      oldTransportIds.includes(changedEventId) !== currentTransportIds.includes(changedEventId) ||
      routeTransportChanged(previousEvents?.find((event) => event.id === changedEventId), events.find((event) => event.id === changedEventId))
    );
    if (endpointChanged || transportChanged) {
      const invalidated = invalidateRouteReference(associated, from.date, from.endTime);
      routes.push(invalidated);
      costs = applyRouteCost(invalidated, events, costs);
    } else {
      routes.push(associated);
      costs = applyRouteCost(associated, events, costs);
    }
  }
  return { routeLegs: routes, costs: restoreReleasedTransportCosts(routeLegs, routes, events, costs, previousEvents ?? events) };
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
      if (!adjacentRoutePair(current.events, from.id, to.id)) throw new PlanValidationError("只能按日程顺序记录当天相邻两个已确认地点的路线。");
      if (planEventEnd(from).getTime() > Date.parse(`${input.route.date}T${input.route.departureTime}:00+08:00`)) throw new PlanValidationError("出发时刻不能早于上一项结束时间。");

      const route = { ...input.route, transportEventIds: routeTransportEventIds(input.route, current.events), conflict: input.route.status === "unavailable" ? null : routeConflict({
        route: input.route,
        earliestDate: to.date,
        earliestStartTime: to.startTime,
      }) };
      const routeLegs = [
        ...current.routeLegs.filter((leg) => leg.fromEventId !== route.fromEventId || leg.toEventId !== route.toEventId),
        routeLegSchema.parse(route),
      ];
      const costs = restoreReleasedTransportCosts(current.routeLegs, routeLegs, current.events,
        applyRouteCost(routeLegSchema.parse(route), current.events, current.costs));
      const costErrors = validatePlanCosts(costs, current.events);
      if (costErrors.length > 0) throw new PlanValidationError(costErrors[0]);
      const validationResults = validationWithTickets(
        validatePlan({ events: current.events, pendingItems: current.pendingItems }, current.requestSnapshot, costs),
        current.tickets,
        current.events,
      );
      if (validationResults.errors.length > 0) throw new PlanValidationError(validationResults.errors[0]);

      const created = await transaction.planVersion.create({ data: {
        tripId: row.tripId,
        versionNumber: row.versionNumber + 1,
        requestRevision: row.requestRevision,
        requestSnapshot: row.requestSnapshot,
        events: row.events,
        costs: JSON.stringify(costs),
        places: row.places,
        routeLegs: JSON.stringify(routeLegs),
        tickets: JSON.stringify(current.tickets),
        pendingItems: row.pendingItems,
        validationResults: JSON.stringify(validationResults),
        requirementUpToDate: row.requirementUpToDate,
      } });
      if (input.abortSignal?.aborted) throw new PlanConflictError("本次路线查询已取消。");
      await copyEvidenceFacts(transaction, row.id, created.id, current, { events: current.events, costs });
      await transaction.trip.update({ where: { id: row.tripId }, data: {
        currentPlanVersionId: created.id,
        status: !row.requirementUpToDate ? "plan_needs_update" : validationResults.warnings.length > 0 ? "plan_needs_review" : "planned",
      } });
      const saved = await transaction.planVersion.findUnique({ where: { id: created.id }, include: { trip: { select: { currentPlanVersionId: true } } } });
      if (!saved) throw new PlanConflictError();
      return serializePlan(saved);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new PlanConflictError("计划已变化，请刷新后重试。");
    throw error;
  }
}

function updateRoutesAfterTicketChange(input: {
  routeLegs: RouteLeg[];
  previousEvents: PlanEvent[];
  events: PlanEvent[];
  costs: PlanCostItem[];
  changedEventIds: string[];
}) {
  let routes: RouteLeg[] = [];
  let costs = input.costs;
  const changed = new Set(input.changedEventIds);

  // A ticket fact can change the effective station or time even when the old
  // event row happens to keep the same placeholder timing. Invalidate first,
  // then let the normal event-change path handle adjacency and protected costs.
  for (const leg of input.routeLegs) {
    if (!changed.has(leg.fromEventId) && !changed.has(leg.toEventId)) {
      routes.push(leg);
      continue;
    }
    const from = input.events.find((event) => event.id === leg.fromEventId);
    if (!from) {
      routes.push(leg);
      continue;
    }
    const invalidated = invalidateRouteReference(leg, from.date, from.endTime);
    routes.push(invalidated);
    costs = applyRouteCost(invalidated, input.events, costs);
  }

  for (const eventId of input.changedEventIds) {
    const result = updateRoutesAfterEventChange(
      routes,
      input.events,
      costs,
      eventId,
      input.previousEvents,
    );
    routes = result.routeLegs;
    costs = result.costs;
  }
  return { routeLegs: routes, costs };
}

function ticketEventForAction(events: PlanEvent[], eventId: string, direction: "departure" | "return") {
  const event = events.find((item) => item.id === eventId);
  if (!event) throw new PlanValidationError("票据关联的去程或返程日程不存在。");
  const expectedType = direction === "departure" ? "departure_transport" : "return_transport";
  if (event.type !== expectedType) {
    throw new PlanValidationError("票据方向必须关联到对应的去程或返程日程。");
  }
  return event;
}

function preserveTicketCostReference(cost: PlanCostItem, referenceTotalCents: number | null, referenceLabel: string, snapshot: RequestSnapshot) {
  const totals = costItemLineTotals(cost, budgetFactorsFromSnapshot(snapshot));
  const marker = "；票面金额核对：";
  const baseNote = (cost.note ?? "").split(marker)[0];
  if (referenceTotalCents !== null && totals.minCents === referenceTotalCents && totals.maxCents === referenceTotalCents) {
    return cost.note?.includes(marker) ? { ...cost, note: baseNote || null } : cost;
  }
  const difference = referenceTotalCents !== null && totals.minCents !== null && totals.minCents === totals.maxCents
    ? referenceTotalCents - totals.minCents : null;
  const differenceNote = difference === null ? "差额待核对" : `参考比预算记录${difference >= 0 ? "高" : "低"} ${formatMoneyRange(Math.abs(difference), null)}`;
  return { ...cost, note: `${baseNote.slice(0, 70)}${marker}${referenceLabel}；预算原记录 ${formatMoneyRange(totals.minCents, totals.maxCents)}；${differenceNote}。原金额及付款/退款状态保留，差额可能涉及退款或手续费，请在预算中另行核对。`.slice(0, 240) };
}

function applyTicketCosts(tickets: Ticket[], events: PlanEvent[], costs: PlanCostItem[], snapshot: RequestSnapshot) {
  let result = [...costs];

  for (const ticket of tickets) {
    if (!ticket.confirmedAt || ticket.status === "draft") continue;
    const id = `ticket-${ticket.id}`;
    const existing = result.find((cost) => cost.id === id);
    const ticketTotal = ticket.fareCents === null ? null : ticket.fareCents * ticket.passengerCount;
    const referenceLabel = `主票每人 ${formatMoneyRange(ticket.fareCents, null)} × ${ticket.passengerCount} 人，合计 ${formatMoneyRange(ticketTotal, null)}`;
    // The budget editor owns payment and refund facts after initial creation.
    // Never restore a refunded amount or reset paid/refund_pending here.
    if (existing && (existing.unitAmountCents !== null || hasProtectedCostFact(existing) || ticket.fareCents === null)) {
      result = result.map((cost) => cost.id === id ? preserveTicketCostReference(cost, ticketTotal, referenceLabel, snapshot) : cost);
      continue;
    }
    const protectedBase = result.find((cost) => cost.id === `cost-${ticket.eventId}` && hasProtectedCostFact(cost));
    const firstConfirmedTicket = tickets.find((item) => item.eventId === ticket.eventId && item.confirmedAt && item.status !== "draft");
    if (protectedBase && firstConfirmedTicket?.id === ticket.id) {
      // The first ticket may already be represented by a confirmed event cost.
      // Keep its stable cost ID and evidence; further tickets get separate rows.
      result = result.map((cost) => cost.id === protectedBase.id ? preserveTicketCostReference(cost, ticketTotal, referenceLabel, snapshot) : cost);
      continue;
    }
    const item = {
      id,
      linkedEventId: ticket.eventId,
      category: "transport" as const,
      currency: "CNY" as const,
      unit: "per_ticket" as const,
      unitAmountCents: ticket.fareCents,
      unitAmountMaxCents: null,
      quantity: ticket.passengerCount,
      certainty: ticket.fareCents === null ? "pending_confirmation" as const : "user_confirmed" as const,
      paymentStatus: "not_paid" as const,
      source: ticket.fareCents === null ? "ai_draft" as const : "user_confirmed" as const,
      eventRemoved: false,
      note: ticket.status === "active"
        ? "用户确认的票面金额；退改签或退款后请在预算中另行确认。"
        : "历史票面金额保留；退票/替换不自动归零，退款到账需另行确认。",
    };
    result = existing ? result.map((cost) => cost.id === id ? planCostItemSchema.parse(item) : cost) : [...result, planCostItemSchema.parse(item)];
  }

  const ticketCostEvents = new Set(
    tickets.filter((ticket) => ticket.confirmedAt && ticket.status !== "draft").map((ticket) => ticket.eventId),
  );
  return result.filter((cost) =>
    cost.id.startsWith("ticket-") ||
    cost.id.startsWith("route-") ||
    !ticketCostEvents.has(cost.linkedEventId) ||
    cost.id !== `cost-${cost.linkedEventId}` ||
    hasProtectedCostFact(cost)
  );
}

function applyTicketTransferCosts(tickets: Ticket[], routes: RouteLeg[], costs: PlanCostItem[], snapshot: RequestSnapshot) {
  const applicable = new Set<string>();
  let result = [...costs];
  for (const ticket of tickets.filter(isActiveTicket)) {
    for (const side of ["access", "egress"] as const) {
      const mode = side === "access" ? ticket.accessMode : ticket.egressMode;
      if (!mode) continue;
      const fare = side === "access" ? ticket.accessFareCents : ticket.egressFareCents;
      const referenceLabel = `${side === "access" ? "出发" : "到达"}接驳全段参考 ${formatMoneyRange(fare, null)}`;
      // The same city segment may already carry an expense. Keep confirmed or
      // paid facts; replace only disposable route estimates with this record.
      const routeCostIds = new Set(routes.filter((route) => side === "access" ? route.toEventId === ticket.eventId : route.fromEventId === ticket.eventId)
        .map((route) => routeCostId(route.fromEventId, route.toEventId)));
      if (result.some((cost) => routeCostIds.has(cost.id) && hasProtectedCostFact(cost))) {
        result = result.map((cost) => routeCostIds.has(cost.id) && hasProtectedCostFact(cost)
          ? preserveTicketCostReference(cost, fare, referenceLabel, snapshot) : cost);
        continue;
      }
      result = result.filter((cost) => !routeCostIds.has(cost.id));
      const identity = side === "access"
        ? [ticket.eventId, side, ticket.date, ticket.departureTime, ticket.chainOriginName, ticket.fromName, ticket.fromDetail, mode]
        : [ticket.eventId, side, ticket.arrivalDate, ticket.arrivalTime, ticket.toName, ticket.toDetail, ticket.chainDestinationName, mode];
      const id = `ticket-transfer-${crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24)}`;
      // Shared travelers reuse one segment expense. Do not let a later ticket
      // erase the first reference's discrepancy note for that same segment.
      if (applicable.has(id)) continue;
      applicable.add(id);
      const existing = result.find((cost) => cost.id === id);
      if (existing && (existing.unitAmountCents !== null || hasProtectedCostFact(existing) || fare === null)) {
        result = result.map((cost) => cost.id === id ? preserveTicketCostReference(cost, fare, referenceLabel, snapshot) : cost);
        continue;
      }
      const item = planCostItemSchema.parse({
        id, linkedEventId: ticket.eventId, category: "local_transport", currency: "CNY", unit: "one_time",
        unitAmountCents: fare, unitAmountMaxCents: null, quantity: null, transferSide: side,
        certainty: fare === null ? "pending_confirmation" : "user_confirmed", paymentStatus: "not_paid",
        source: fare === null ? "ai_draft" : "user_confirmed", eventRemoved: false,
        note: `${ticket.direction === "departure" ? "去程" : "返程"}${side === "access" ? "出发" : "到达"}接驳全段费用，只计一次；多人同段共享，退款及金额变化请在预算中另行确认。`,
      });
      result = existing ? result.map((cost) => cost.id === id ? item : cost) : [...result, item];
    }
  }
  result = result.filter((cost) => !cost.id.startsWith("ticket-transfer-") || applicable.has(cost.id) || hasProtectedCostFact(cost));
  return result;
}

export async function savePlanTicketEdit(input: {
  tripId: string;
  expectedPlanVersion: number;
  action: TicketAction;
}) {
  const action = ticketActionSchema.parse(input.action);
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
      if (!row) throw new PlanNotFoundError();
      if (row.trip.currentPlanVersionId !== row.id) {
        throw new PlanConflictError("计划已变化，请刷新后重新确认票面；历史版本保持只读。");
      }

      const current = serializePlan(row);
      const now = new Date();
      let tickets: Ticket[];
      let actionEventId: string;
      if (action.action === "create_draft") {
        ticketEventForAction(current.events, action.ticket.eventId, action.ticket.direction);
        tickets = [...current.tickets, createDraftTicket(action.ticket, now)];
        actionEventId = action.ticket.eventId;
      } else if (action.action === "activate") {
        ticketEventForAction(current.events, action.ticket.eventId, action.ticket.direction);
        tickets = [...current.tickets, activateTicket(action.ticket, now)];
        actionEventId = action.ticket.eventId;
      } else if (action.action === "cancel") {
        const target = current.tickets.find((ticket) => ticket.id === action.ticketId);
        if (!target) throw new PlanValidationError("没有找到要确认退票的指定票据。");
        if (target.status !== "active") throw new PlanValidationError("只能对当前有效票确认退票事实。");
        tickets = current.tickets.map((ticket) => ticket.id === target.id ? cancelTicket(ticket, now) : ticket);
        actionEventId = target.eventId;
      } else if (action.action === "activate_draft") {
        const target = current.tickets.find((ticket) => ticket.id === action.ticketId);
        if (!target) throw new PlanValidationError("没有找到要确认的草稿票面。");
        if (target.status !== "draft") throw new PlanValidationError("只有草稿票面可以确认有效。");
        const { id, status, confirmedAt, cancelledAt, replacedAt, replacedByTicketId, createdAt, updatedAt, ...core } = target;
        void id;
        void status;
        void confirmedAt;
        void cancelledAt;
        void replacedAt;
        void replacedByTicketId;
        void createdAt;
        void updatedAt;
        activeTicketCoreSchema.parse(core);
        tickets = current.tickets.map((ticket) => ticket.id === target.id ? {
          ...ticket,
          status: "active" as const,
          confirmedAt: now.toISOString(),
          updatedAt: now.toISOString(),
        } : ticket);
        actionEventId = target.eventId;
      } else if (action.action === "update_details") {
        const target = current.tickets.find((ticket) => ticket.id === action.ticketId);
        if (!target) throw new PlanValidationError("没有找到要补充资料的票面。");
        ticketEventForAction(current.events, action.ticket.eventId, action.ticket.direction);
        let updated: Ticket;
        try { updated = updateTicketDetails(target, action.ticket, now); }
        catch (error) { throw new PlanValidationError(error instanceof Error ? error.message : "票面资料不能更新。"); }
        tickets = current.tickets.map((ticket) => ticket.id === target.id ? updated : ticket);
        actionEventId = target.eventId;
      } else {
        const target = current.tickets.find((ticket) => ticket.id === action.ticketId);
        if (!target) throw new PlanValidationError("没有找到要替换的指定原票。");
        if (target.status !== "active") throw new PlanValidationError("只能替换当前有效票。");
        if (target.eventId !== action.replacement.eventId || target.direction !== action.replacement.direction) {
          throw new PlanValidationError("替换票必须关联同一方向和同一主交通日程。");
        }
        ticketEventForAction(current.events, action.replacement.eventId, action.replacement.direction);
        const { replaced, replacement } = replaceTicket(target, action.replacement, now);
        tickets = [...current.tickets.map((ticket) => ticket.id === target.id ? replaced : ticket), replacement];
        actionEventId = target.eventId;
      }

      const draftOnly = action.action === "create_draft" || action.action === "update_details" &&
        current.tickets.find((ticket) => ticket.id === action.ticketId)?.status === "draft";
      const planAfterTickets = preparePlanForStorage({
        events: draftOnly ? current.events : applyTicketsToEvents(current.events, tickets, current.tickets),
        pendingItems: current.pendingItems,
      });
      const changedEventIds = draftOnly ? [] : [
        ...new Set([actionEventId, ...ticketChangedEventIds(current.events, planAfterTickets.events)]),
      ];
      const { routeLegs, costs } = updateRoutesAfterTicketChange({
        routeLegs: current.routeLegs,
        previousEvents: current.events,
        events: planAfterTickets.events,
        costs: current.costs,
        changedEventIds,
      });
      const ticketCosts = draftOnly ? current.costs : applyTicketTransferCosts(
        tickets, current.routeLegs, applyTicketCosts(tickets, planAfterTickets.events, costs, current.requestSnapshot), current.requestSnapshot,
      );

      const costErrors = validatePlanCosts(ticketCosts, planAfterTickets.events);
      if (costErrors.length > 0) throw new PlanValidationError(costErrors[0]);
      const ticketValidation = validateTickets(tickets, planAfterTickets.events);
      if (ticketValidation.errors.length > 0) throw new PlanValidationError(ticketValidation.errors[0]);
      const validationResults = validationWithTickets(
        validatePlan(planAfterTickets, current.requestSnapshot, ticketCosts),
        tickets,
        planAfterTickets.events,
      );

      const created = await transaction.planVersion.create({
        data: {
          tripId: row.tripId,
          versionNumber: row.versionNumber + 1,
          requestRevision: row.requestRevision,
          requestSnapshot: row.requestSnapshot,
          events: JSON.stringify(planAfterTickets.events),
          costs: JSON.stringify(ticketCosts),
          places: row.places,
          routeLegs: JSON.stringify(routeLegs),
          tickets: JSON.stringify(tickets),
          pendingItems: row.pendingItems,
          validationResults: JSON.stringify(validationResults),
          requirementUpToDate: row.requirementUpToDate,
        },
      });
      await copyEvidenceFacts(
        transaction,
        row.id,
        created.id,
        current,
        { events: planAfterTickets.events, costs: ticketCosts },
      );
      await transaction.trip.update({
        where: { id: row.tripId },
        data: {
          currentPlanVersionId: created.id,
          status: !row.requirementUpToDate || validationResults.errors.length > 0 || validationResults.warnings.length > 0
            ? (!row.requirementUpToDate ? "plan_needs_update" : "plan_needs_review")
            : "planned",
        },
      });

      const saved = await transaction.planVersion.findUnique({
        where: { id: created.id },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!saved) throw new PlanConflictError();
      return serializePlan(saved);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new PlanConflictError("计划已变化，票面确认不能提交；请刷新后重试。");
    }
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
