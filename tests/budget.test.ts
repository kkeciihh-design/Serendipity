import { describe, expect, it } from "vitest";
import {
  applyPlanCostEdit,
  budgetFactorsFromSnapshot,
  budgetTargetCentsFromSnapshot,
  calculateBudgetSummary,
  costItemLineTotals,
  derivePlanCosts,
  validatePlanCosts,
  type PlanCostItem,
} from "../lib/budget";
import {
  emptyRequestSnapshot,
  normalizeRequestSnapshot,
  type RequestSnapshot,
} from "../lib/trip-request";
import type { PlanEvent } from "../lib/plan";

function snapshot(input: Partial<RequestSnapshot> = {}): RequestSnapshot {
  return normalizeRequestSnapshot({
    ...emptyRequestSnapshot(),
    destination: "长沙",
    startDate: "2026-11-01",
    endDate: "2026-11-02",
    travelerCount: 2,
    budgetAmountCents: 150000,
    budgetScope: "total",
    ...input,
    fieldSources: {
      ...emptyRequestSnapshot().fieldSources,
      ...(input.fieldSources ?? {}),
    },
  });
}

function cost(
  input: Partial<PlanCostItem> & Pick<PlanCostItem, "id" | "linkedEventId" | "category">,
): PlanCostItem {
  return {
    currency: "CNY",
    unit: "one_time",
    unitAmountCents: null,
    unitAmountMaxCents: null,
    quantity: null,
    certainty: "pending_confirmation",
    paymentStatus: "not_paid",
    source: "ai_draft",
    eventRemoved: false,
    note: null,
    ...input,
  };
}

function event(id: string): PlanEvent {
  return {
    id,
    dayNumber: 1,
    date: "2026-11-01",
    startTime: "08:00",
    endTime: "09:00",
    type: "activity",
    title: `活动 ${id}`,
    locationName: "长沙",
    suggestedDurationSeconds: 3600,
    costDraftCents: null,
    costStatus: "pending_confirmation",
  };
}

describe("budget calculation", () => {
  it("sums the 1286 yuan demo case into matching totals and categories", () => {
    const costs = [
      cost({
        id: "cost-departure",
        linkedEventId: "departure",
        category: "transport",
        unitAmountCents: 48600,
      }),
      cost({
        id: "cost-hotel",
        linkedEventId: "hotel",
        category: "accommodation",
        unitAmountCents: 28000,
      }),
      cost({
        id: "cost-meal",
        linkedEventId: "meal",
        category: "meal",
        unitAmountCents: 26000,
      }),
      cost({
        id: "cost-ticket",
        linkedEventId: "ticket",
        category: "ticket",
        unitAmountCents: 6000,
      }),
      cost({
        id: "cost-taxi",
        linkedEventId: "taxi",
        category: "local_transport",
        unitAmountCents: 8000,
      }),
      cost({
        id: "cost-other",
        linkedEventId: "other",
        category: "other",
        unitAmountCents: 12000,
      }),
    ];

    const summary = calculateBudgetSummary(costs, snapshot());
    expect(summary.totalMinCents).toBe(128600);
    expect(summary.totalMaxCents).toBe(128600);
    expect(summary.perPersonMinCents).toBe(64300);
    expect(summary.unknownItemCount).toBe(0);
    expect(summary.overspendStatus).toBe("none");
    expect(summary.categories.map((item) => item.category)).toEqual([
      "transport",
      "accommodation",
      "meal",
      "ticket",
      "local_transport",
      "other",
    ]);
    expect(summary.categories.map((item) => item.minTotalCents)).toEqual([
      48600,
      28000,
      26000,
      6000,
      8000,
      12000,
    ]);
    expect(
      summary.categories.reduce((total, item) => total + item.minTotalCents, 0),
    ).toBe(summary.totalMinCents);
  });

  it("applies traveler, room, night, and ticket quantities from the same snapshot", () => {
    const factors = budgetFactorsFromSnapshot(
      snapshot({
        startDate: "2026-11-01",
        endDate: "2026-11-04",
        travelerCount: 3,
      }),
    );
    expect(factors).toEqual({ travelerCount: 3, roomCount: 2, nightCount: 3 });

    const perPerson = cost({
      id: "cost-person",
      linkedEventId: "person",
      category: "ticket",
      unit: "per_person",
      unitAmountCents: 10000,
    });
    const roomNight = cost({
      id: "cost-room",
      linkedEventId: "room",
      category: "accommodation",
      unit: "per_room_per_night",
      unitAmountCents: 28000,
    });
    const perNight = cost({
      id: "cost-night",
      linkedEventId: "night",
      category: "other",
      unit: "per_night",
      unitAmountCents: 2000,
    });
    const perTicket = cost({
      id: "cost-ticket",
      linkedEventId: "ticket",
      category: "ticket",
      unit: "per_ticket",
      unitAmountCents: 6000,
      quantity: 2,
    });

    expect(costItemLineTotals(perPerson, factors)).toEqual({
      quantity: 3,
      minCents: 30000,
      maxCents: 30000,
    });
    expect(costItemLineTotals(roomNight, factors)).toEqual({
      quantity: 6,
      minCents: 168000,
      maxCents: 168000,
    });
    expect(costItemLineTotals(perNight, factors)).toEqual({
      quantity: 3,
      minCents: 6000,
      maxCents: 6000,
    });
    expect(costItemLineTotals(perTicket, factors)).toEqual({
      quantity: 2,
      minCents: 12000,
      maxCents: 12000,
    });
  });

  it("keeps ranges, unknown amounts, zero amounts, and refund pending separate", () => {
    const costs = [
      cost({
        id: "cost-range",
        linkedEventId: "range",
        category: "meal",
        unit: "per_person",
        unitAmountCents: 8000,
        unitAmountMaxCents: 12000,
      }),
      cost({
        id: "cost-unknown",
        linkedEventId: "unknown",
        category: "ticket",
      }),
      cost({
        id: "cost-free",
        linkedEventId: "free",
        category: "ticket",
        unitAmountCents: 0,
        certainty: "user_confirmed",
        source: "user_confirmed",
      }),
      cost({
        id: "cost-refund",
        linkedEventId: "refund",
        category: "transport",
        unitAmountCents: 48600,
        paymentStatus: "refund_pending",
      }),
    ];

    const summary = calculateBudgetSummary(costs, snapshot());
    expect(summary.totalMinCents).toBe(48600 + 16000);
    expect(summary.totalMaxCents).toBe(48600 + 24000);
    expect(summary.unknownItemCount).toBe(1);
    expect(summary.rangeItemCount).toBe(1);
    expect(summary.overspendStatus).toBe("unknown_amounts");
    expect(summary.refundPendingItemCount).toBe(1);
    expect(summary.confirmedItemCount).toBe(1);
  });

  it("separates definite and possible overspend by range bounds", () => {
    const range = [
      cost({
        id: "cost-range",
        linkedEventId: "range",
        category: "meal",
        unit: "per_person",
        unitAmountCents: 8000,
        unitAmountMaxCents: 12000,
      }),
    ];

    expect(
      calculateBudgetSummary(range, snapshot({ budgetAmountCents: 15000 }))
        .overspendStatus,
    ).toBe("confirmed");
    expect(
      calculateBudgetSummary(range, snapshot({ budgetAmountCents: 20000 }))
        .overspendStatus,
    ).toBe("possible");
    expect(
      calculateBudgetSummary(range, snapshot({ budgetAmountCents: 25000 }))
        .overspendStatus,
    ).toBe("none");
  });

  it("expands a per-person budget target by the snapshot traveler count", () => {
    expect(
      budgetTargetCentsFromSnapshot(
        snapshot({
          travelerCount: 3,
          budgetAmountCents: 50000,
          budgetScope: "per_person",
        }),
      ),
    ).toBe(150000);
    expect(
      budgetTargetCentsFromSnapshot(
        snapshot({ budgetAmountCents: null, budgetScope: null }),
      ),
    ).toBeNull();
  });
});

describe("cost items and edits", () => {
  it("derives one uniquely associated draft cost per event", () => {
    const events = [
      {
        ...event("departure"),
        type: "departure_transport" as const,
        costDraftCents: 48600,
        costStatus: "estimated" as const,
      },
      {
        ...event("hotel"),
        type: "accommodation" as const,
        costDraftCents: null,
        costStatus: "pending_confirmation" as const,
      },
      {
        ...event("manual"),
        type: "activity" as const,
        costDraftCents: 12000,
        costStatus: "user_confirmed" as const,
      },
    ];
    const costs = derivePlanCosts(events);
    expect(costs.map((item) => item.linkedEventId)).toEqual([
      "departure",
      "hotel",
      "manual",
    ]);
    expect(costs[0]).toMatchObject({
      id: "cost-departure",
      category: "transport",
      unit: "one_time",
      unitAmountCents: 48600,
      certainty: "estimated",
    });
    expect(costs[1]).toMatchObject({
      category: "accommodation",
      unitAmountCents: null,
    });
    expect(costs[2]).toMatchObject({
      category: "ticket",
      certainty: "pending_confirmation",
    });
    expect(validatePlanCosts(costs, events)).toEqual([]);
  });

  it("validates unique association, event existence, and amount ranges", () => {
    const duplicate = [
      cost({ id: "cost-a", linkedEventId: "event-a", category: "meal" }),
      cost({ id: "cost-b", linkedEventId: "event-a", category: "meal" }),
    ];
    expect(
      validatePlanCosts(duplicate, [event("event-a")]).join(""),
    ).toContain("重复关联");

    const missingEvent = [
      cost({ id: "cost-a", linkedEventId: "event-a", category: "meal" }),
    ];
    expect(
      validatePlanCosts(missingEvent, []).join(""),
    ).toContain("关联的事件不存在");

    const badRange = [
      cost({
        id: "cost-a",
        linkedEventId: "event-a",
        category: "meal",
        unitAmountCents: 12000,
        unitAmountMaxCents: 8000,
      }),
    ];
    expect(
      validatePlanCosts(badRange, [event("event-a")]).join(""),
    ).toContain("上限不能低于下限");

    const missingMin = [
      cost({
        id: "cost-a",
        linkedEventId: "event-a",
        category: "meal",
        unitAmountCents: null,
        unitAmountMaxCents: 8000,
      }),
    ];
    expect(
      validatePlanCosts(missingMin, [event("event-a")]).join(""),
    ).toContain("不能只填写区间上限");

    const removed = [
      cost({
        id: "cost-a",
        linkedEventId: "event-a",
        category: "meal",
        eventRemoved: true,
      }),
    ];
    expect(validatePlanCosts(removed, [])).toEqual([]);
  });

  it("confirms known amounts and keeps unknown amounts out of totals", () => {
    const source = [
      cost({
        id: "cost-meal",
        linkedEventId: "meal",
        category: "meal",
        unitAmountCents: 8000,
      }),
    ];

    const confirmed = applyPlanCostEdit(source, {
      costId: "cost-meal",
      unit: "per_person",
      unitAmountCents: 8000,
      unitAmountMaxCents: null,
      quantity: null,
      paymentStatus: "paid",
    });
    expect(confirmed[0]).toMatchObject({
      unit: "per_person",
      quantity: null,
      certainty: "user_confirmed",
      paymentStatus: "paid",
      source: "user_confirmed",
    });

    const unknown = applyPlanCostEdit(confirmed, {
      costId: "cost-meal",
      unit: "per_person",
      unitAmountCents: null,
      unitAmountMaxCents: null,
      quantity: null,
      paymentStatus: "not_paid",
    });
    expect(unknown[0]).toMatchObject({
      unitAmountCents: null,
      certainty: "pending_confirmation",
    });

    expect(() =>
      applyPlanCostEdit(source, {
        costId: "cost-meal",
        unit: "one_time",
        unitAmountCents: 8000,
        unitAmountMaxCents: null,
        quantity: null,
        paymentStatus: "not_paid",
      }),
    ).toThrow(/没有需要保存的费用修改/);

    const ticket = applyPlanCostEdit(source, {
      costId: "cost-meal",
      unit: "per_ticket",
      unitAmountCents: 6000,
      unitAmountMaxCents: null,
      quantity: null,
      paymentStatus: "not_paid",
    });
    expect(ticket[0]).toMatchObject({ unit: "per_ticket", quantity: 1 });
  });
});
