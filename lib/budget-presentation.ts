import type { BudgetSummary, CostCategory } from "./budget";

/** One travel-facing transport total includes intercity fares and local rides. */
export function travelBudgetCategories(summary: BudgetSummary) {
  const groups: { category: CostCategory; label: string; members: CostCategory[] }[] = [
    { category: "transport", label: "交通", members: ["transport", "local_transport"] },
    { category: "ticket", label: "门票", members: ["ticket"] },
    { category: "meal", label: "餐饮", members: ["meal"] },
    { category: "accommodation", label: "住宿", members: ["accommodation"] },
    { category: "other", label: "其他", members: ["other"] },
  ];
  return groups.map((group) => {
    const items = summary.categories.filter((item) => group.members.includes(item.category));
    return {
      category: group.category, label: group.label,
      minTotalCents: items.reduce((total, item) => total + item.minTotalCents, 0),
      maxTotalCents: items.reduce((total, item) => total + item.maxTotalCents, 0),
      unknownItemCount: items.reduce((total, item) => total + item.unknownItemCount, 0),
      knownItemCount: items.reduce((total, item) => total + item.knownItemCount, 0),
    };
  }).filter((group) => group.category !== "other" || group.maxTotalCents > 0 || group.unknownItemCount > 0);
}
