import { z } from "zod";
import { parseTravelBackup } from "../scripts/travel-backup-format.mjs";
import { planEventSchema, planPendingItemSchema, planValidationResultsSchema } from "./plan";
import { requestSnapshotSchema, requestQuestionSchema, defaultAssumptionSchema } from "./trip-request";
import { planCostItemSchema } from "./budget";
import { placeSchema, validatePlaceReferences } from "./places";
import { routeLegSchema } from "./routes";
import { ticketSchema } from "./tickets";
import { checklistItemSchema } from "./checklist";
import { executionSchema } from "./execution";
import { advisoryItemSchema, advisoryWeatherStateSchema } from "./advisories";
import { evidenceFieldSchema } from "./evidence";

export function validateTravelBackup(raw: unknown) {
  const backup = parseTravelBackup(raw);
  try {
    for (const row of backup.tables.TripRequest) {
      if (row.extractedRequest) requestSnapshotSchema.parse(JSON.parse(row.extractedRequest));
      if (row.confirmedRequest) requestSnapshotSchema.parse(JSON.parse(row.confirmedRequest));
      if (row.pendingQuestions) z.array(requestQuestionSchema).parse(JSON.parse(row.pendingQuestions));
      if (row.defaultAssumptions) z.array(defaultAssumptionSchema).parse(JSON.parse(row.defaultAssumptions));
      if (row.fieldSources) z.record(z.string(), z.string()).parse(JSON.parse(row.fieldSources));
    }
    for (const row of backup.tables.PlanVersion) {
      requestSnapshotSchema.parse(JSON.parse(row.requestSnapshot));
      const events = z.array(planEventSchema).parse(JSON.parse(row.events));
      const costs = z.array(planCostItemSchema).parse(JSON.parse(row.costs));
      const places = z.array(placeSchema).parse(JSON.parse(row.places));
      const routes = z.array(routeLegSchema).parse(JSON.parse(row.routeLegs));
      const tickets = z.array(ticketSchema).parse(JSON.parse(row.tickets));
      z.array(planPendingItemSchema).parse(JSON.parse(row.pendingItems));
      planValidationResultsSchema.parse(JSON.parse(row.validationResults));
      validatePlaceReferences(events, places);
      for (const items of [events, costs, places, routes, tickets]) if (new Set(items.map((i) => i.id)).size !== items.length) throw new Error("计划身份重复");
      const ids = new Set(events.map((e) => e.id));
      for (const route of routes) if (!ids.has(route.fromEventId) || !ids.has(route.toEventId)) throw new Error("路线引用不存在的事件");
      for (const ticket of tickets) if (ticket.replacedByTicketId && !tickets.some((t) => t.id === ticket.replacedByTicketId)) throw new Error("替换票据不存在");
    }
    for (const row of backup.tables.ChecklistState) z.array(checklistItemSchema).max(2000).parse(JSON.parse(row.items));
    for (const row of backup.tables.ExecutionState) executionSchema.parse(JSON.parse(row.payload));
    for (const row of backup.tables.AdvisoryState) {
      z.array(advisoryItemSchema).max(200).parse(JSON.parse(row.items));
      advisoryWeatherStateSchema.parse(JSON.parse(row.weather));
    }
    for (const row of backup.tables.EvidenceFact) {
      evidenceFieldSchema.parse(row.field);
      if (row.sourceUrl && !/^https?:\/\//i.test(row.sourceUrl)) throw new Error("来源链接协议无效");
    }
  } catch { throw new Error("备份中的需求、计划、票据、来源或进度字段不完整，无法安全恢复。"); }
  return backup;
}
