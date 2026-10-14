import { describe, expect, it } from "vitest";
import { eventCostSummary, type PlanCostItem } from "../lib/budget";
import { requestFixture } from "./helpers/plan-fixtures";

function cost(id: string, overrides: Partial<PlanCostItem> = {}): PlanCostItem {
  return { id, linkedEventId: "departure", category: "transport", currency: "CNY", unit: "per_ticket",
    unitAmountCents: 10000, unitAmountMaxCents: null, quantity: 1,
    certainty: "user_confirmed", paymentStatus: "paid", source: "user_confirmed", eventRemoved: false, note: null,
    ...overrides };
}

describe("multi-ticket timeline budget totals", () => {
  const snapshot = requestFixture();
  const rows = [
    cost("ticket-first", { quantity: 2, unitAmountMaxCents: 12000 }),
    cost("ticket-second", { unitAmountCents: 5000 }),
    cost("ticket-transfer-shared", { transferSide: "access", category: "local_transport", unit: "one_time",
      unitAmountCents: 2000, quantity: null, paymentStatus: "not_paid" }),
    cost("route-separate", { unitAmountCents: 99999 }),
    cost("other-event", { linkedEventId: "return", unitAmountCents: 99999 }),
  ];

  it("sums every ticket and shared transfer once, excluding route summaries and other events", () => {
    expect(eventCostSummary("departure", rows, snapshot)).toMatchObject({
      minCents: 27000, maxCents: 31000, certainty: "user_confirmed", paymentStatus: "not_paid",
    });
    expect(eventCostSummary("missing", rows, snapshot)).toBeNull();
  });

  it("does not label a partial known amount as a confirmed total when any related expense is unknown", () => {
    const unknown = rows.map((row) => row.transferSide ? { ...row, unitAmountCents: null,
      certainty: "pending_confirmation" as const, paymentStatus: "refund_pending" as const } : row);
    expect(eventCostSummary("departure", unknown, snapshot)).toMatchObject({
      minCents: null, maxCents: null, certainty: "pending_confirmation", paymentStatus: "refund_pending",
    });
  });

  it("keeps the weakest certainty across known amounts and marks paid only when all related rows are paid", () => {
    const estimated = rows.map((row) => row.id === "ticket-second" ? { ...row, certainty: "estimated" as const } :
      row.transferSide ? { ...row, paymentStatus: "paid" as const } : row);
    expect(eventCostSummary("departure", estimated, snapshot)).toMatchObject({ minCents: 27000,
      maxCents: 31000, certainty: "estimated", paymentStatus: "paid" });
    estimated[1] = { ...estimated[1], certainty: "pending_confirmation" };
    expect(eventCostSummary("departure", estimated, snapshot)?.certainty).toBe("pending_confirmation");
  });
});
