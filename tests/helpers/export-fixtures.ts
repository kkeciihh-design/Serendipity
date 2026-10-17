import { preparePlanForStorage, validatePlan } from "../../lib/plan";
import { derivePlanCosts } from "../../lib/budget";
import { emptyExecution } from "../../lib/execution";
import { buildPlanRedlines } from "../../lib/redline-service";
import { defaultRedlinePreferences } from "../../lib/redline-preferences";
import type { ExportSnapshot } from "../../lib/export-snapshot";
import { planFixture, requestFixture } from "./plan-fixtures";
import { ticketFixture } from "./ticket-fixtures";
export const PRIVATE_ADDRESS = "合成隐私街道88号星河小区3栋1201室";
export async function exportFixture(days = 2): Promise<ExportSnapshot> {
  const request = requestFixture(days, { travelerCount: 4, budgetScope: "per_person" }), content = preparePlanForStorage(planFixture(request));
  const now = "2026-10-17T04:00:00.000Z";
  const departure = content.events.find((e) => e.id === "departure")!;
  departure.startTime = "00:35"; departure.endTime = "01:35";
  content.events.find((e) => e.id === "d1-preparation")!.locationName = PRIVATE_ADDRESS;
  content.events.find((e) => e.id === "d1-activity")!.title = "长沙历史文化与自然科学综合博物馆超长展馆名称供四天移动阅读检查";
  const costs = derivePlanCosts(content.events);
  const plan = { ...content, id: "test-plan", tripId: "test-trip", versionNumber: 1, requestRevision: 2, requestSnapshot: request,
    costs, places: [], routeLegs: [], tickets: [{ ...ticketFixture(request.startDate!, { chainOriginName: PRIVATE_ADDRESS, accessMode: "walking", accessDurationMinutes: 60,
      departureTime: "00:35", arrivalTime: "01:35", bufferMinutes: 5, seat: "08车06A" }), id: "test-ticket", status: "active" as const,
      confirmedAt: now, createdAt: now, updatedAt: now, cancelledAt: null, replacedAt: null,
      redlinePreferences: { ...defaultRedlinePreferences(5), securitySeconds: 1200, gateWalkingSeconds: 600 } }],
    validationResults: validatePlan(content, request), requirementUpToDate: true, isCurrent: true, createdAt: now, updatedAt: now };
  return { schemaVersion: 1, id: "static-export-test", generatedAt: now, plan, latestRequestRevision: 2, requirementUpToDate: true,
    checklist: { tripId: plan.tripId, revision: 3, planVersion: 1, updatedAt: now, items: [], basis: "test" },
    execution: { ...emptyExecution(), revision: 4, planVersion: 1, updatedAt: now }, evidence: [], redlines: await buildPlanRedlines(plan, now, { cache: false }) };
}
