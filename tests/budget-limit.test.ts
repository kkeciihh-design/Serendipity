import { expect, it } from "vitest";
import { confirmedRequestBudgetLimit, preserveExplicitBudgetCap } from "../lib/budget-limit";
import { deriveGeneratedPlanCosts } from "../lib/generated-costs";
import { calculateBudgetSummary } from "../lib/budget";
import { validateGeneratedPlan } from "../lib/plan";
import { requestFixture, planFixture } from "./helpers/plan-fixtures";

it("preserves the original hard cap even if extraction omits its prose", () => {
  const snapshot = preserveExplicitBudgetCap(requestFixture(3, { budgetAmountCents: 350000 }), "和伴侣去泉州，总预算控制在3500元以内。节奏轻松一点");
  expect(confirmedRequestBudgetLimit(snapshot)).toBe(350000);
  expect(confirmedRequestBudgetLimit({ ...snapshot, constraints: ["总预算尽量不超过3500元"] })).toBeNull();
});

it("rejects the upper end of a newly generated range that breaches an explicit cap", () => {
  const snapshot = requestFixture(3, { budgetAmountCents: 350000, constraints: ["总预算不超过3500元"] });
  const plan = planFixture(snapshot);
  plan.events.filter((event) => event.type === "accommodation").forEach((event) => { event.note = "每间每晚1000-2000元"; event.costDraftCents = 100000; });
  const summary = calculateBudgetSummary(deriveGeneratedPlanCosts(plan.events, snapshot), snapshot);
  expect(summary.totalMinCents).toBeLessThan(350000);
  expect(summary.totalMaxCents).toBeGreaterThan(350000);
  expect(validateGeneratedPlan(plan, snapshot).errors.join(" ")).toContain("预算上限");
});
