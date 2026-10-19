import { expect, it } from "vitest";
import { calculateBudgetSummary, derivePlanCosts } from "../lib/budget";
import { travelBudgetCategories } from "../lib/budget-presentation";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";

it("combines intercity and local fares while keeping the visible categories equal to the trip total", () => {
  const snapshot = requestFixture(2, { travelerCount: 2 });
  const costs = derivePlanCosts(planFixture(snapshot).events);
  costs[0] = { ...costs[0], category: "local_transport", unitAmountCents: 3500 };
  costs[1] = { ...costs[1], category: "meal", unit: "per_person", unitAmountCents: 7000 };
  const summary = calculateBudgetSummary(costs, snapshot);
  const categories = travelBudgetCategories(summary);
  expect(categories.slice(0, 4).map((item) => item.label)).toEqual(["交通", "门票", "餐饮", "住宿"]);
  expect(categories[0].minTotalCents).toBe(summary.categories.filter((item) => ["transport", "local_transport"].includes(item.category)).reduce((sum, item) => sum + item.minTotalCents, 0));
  expect(categories.reduce((sum, item) => sum + item.minTotalCents, 0)).toBe(summary.totalMinCents);
  expect(summary.perPersonMinCents).toBe(Math.round(summary.totalMinCents / 2));
});
