import type { RequestSnapshot } from "./trip-request";

export function confirmedRequestBudgetLimit(snapshot: RequestSnapshot) {
  const clauses = snapshot.constraints.flatMap((value) => value.split(/[。；;！？!?\r\n，,]+|(?<!\d)\.|\.(?!\d)/));
  for (const clause of clauses) {
    if (/左右|尽量|最好|大约|大概|争取/.test(clause)) continue;
    const explicit = clause.match(/((?:人均|每人)?(?:总预算|预算|总费用))\s*(?:(?:上限|不超过|不能超过|最多|至多)\s*[为是：:]?\s*(\d+(?:\.\d{1,2})?)\s*元|(?:控制在)?\s*[为是：:]?\s*(\d+(?:\.\d{1,2})?)\s*元\s*(?:以内|以下))/);
    if (!explicit) continue;
    const perPerson = /人均|每人/.test(explicit[1]) || (!/总/.test(explicit[1]) && snapshot.budgetScope === "per_person");
    return Math.round(Number(explicit[2] ?? explicit[3]) * 100) * (perPerson ? snapshot.travelerCount ?? 1 : 1);
  }
  return null;
}

/** Only used at original extraction; later confirmed edits remain authoritative. */
export function preserveExplicitBudgetCap(snapshot: RequestSnapshot, originalRequest: string): RequestSnapshot {
  const clauses = originalRequest.split(/[。；;！？!?\r\n，,]+/);
  const hard = clauses.find((clause) => confirmedRequestBudgetLimit({ ...snapshot, constraints: [clause] }) !== null);
  if (!hard) return snapshot;
  const text = hard.trim().slice(0, 120);
  return { ...snapshot, constraints: [text, ...snapshot.constraints.filter((item) => item !== text)].slice(0, 12) };
}
