import { forwardCheck, formatRedlineTime, isoAt, REDLINE_ALGORITHM, reverseCandidate, totalBuffer,
  type RedlineInput, type RedlineResult, type TimingRoute } from "./redlines";

// Lookup is outside the deterministic functions. A resolver must return the
// actual applicability window, never relabel a previous query with a new time.
export type RedlineRouteLookup = (departureAt: string) => Promise<{
  route: TimingRoute; nextCandidateAt?: string;
}>;

export async function resolveRedline(input: RedlineInput, now: string, version: string, lookup: RedlineRouteLookup): Promise<RedlineResult> {
  let candidate = reverseCandidate(input);
  let suggestedCheck: RedlineResult["suggestedCheck"] = null;
  const attempts: RedlineResult["attempts"] = [];
  let reason = "按固定耗时倒推并正向复核。";
  if (candidate) {
    if (input.route.kind === "fixed") suggestedCheck = forwardCheck(input, candidate, input.route);
    else {
      for (let round = 0; round < 3; round++) {
        let response: Awaited<ReturnType<RedlineRouteLookup>>;
        try { response = await lookup(candidate); }
        catch {
          suggestedCheck = forwardCheck(input, candidate, { ...input.route, validFrom: null, validUntil: null, status: "pending_confirmation" });
          attempts.push({ candidateAt: candidate, check: suggestedCheck });
          reason = "候选时刻路线查询失败，等待重新核实。"; break;
        }
        const check = forwardCheck(input, candidate, response.route);
        attempts.push({ candidateAt: candidate, check });
        suggestedCheck = check;
        if (check.status === "feasible") { reason = "建议时刻已正向复核所有截止；仅适用于所列路线资料。"; break; }
        if (!response.route.futureCapability) { reason = "缺少未来时刻路线能力，不能确认建议时刻的班次与运营。"; break; }
        const next = response.nextCandidateAt ?? reverseCandidate(input, response.route);
        if (!next || next === candidate || attempts.some((attempt) => attempt.candidateAt === next)) {
          reason = "候选时刻未收敛，等待补充班次资料。"; break;
        }
        if (round === 2) { reason = "已达 3 轮候选复核上限（含首次），未得到一致结果。"; break; }
        candidate = next;
      }
    }
  } else reason = "缺少接驳耗时或截止，暂不能倒推出发时刻。";

  let currentRoute = input.route;
  if (input.route.kind === "timed") {
    try { currentRoute = (await lookup(now)).route; }
    catch { currentRoute = { ...input.route, validFrom: null, validUntil: null, status: "pending_confirmation" }; }
  }
  const currentCheck = forwardCheck(input, now, currentRoute);
  const conflicts = [...input.blockers];
  if (candidate && input.earliestDepartureAt && Date.parse(candidate) < Date.parse(input.earliestDepartureAt)) {
    conflicts.push(`上一项结束于 ${formatRedlineTime(input.earliestDepartureAt)}，晚于建议出发；请调整相邻安排或核实其他路线。`);
  }
  const known = input.deadlines.every((d) => d.nature === "confirmed" && d.at);
  const verifiedRoute = suggestedCheck?.route.status === "verified";
  const precision = conflicts.length || !suggestedCheck || suggestedCheck.status !== "feasible" ||
    input.deadlines.some((d) => !d.at) || suggestedCheck.route.status === "pending_confirmation"
    ? "pending_confirmation" : known && verifiedRoute ? "verified" : "estimated";
  if (precision !== "verified" && reason.startsWith("建议时刻已")) reason += "来源或截止仍含假设，结论保持估算 / 待确认。";
  return { input, algorithm: REDLINE_ALGORITHM, calculationVersion: `${REDLINE_ALGORITHM}:${version}`,
    calculatedAt: isoAt(Date.parse(now)), suggestedAt: candidate,
    necessarySeconds: (suggestedCheck?.route.durationSeconds ?? input.route.durationSeconds) === null ? null
      : (suggestedCheck?.route.durationSeconds ?? input.route.durationSeconds)! + input.steps.reduce((sum, s) => sum + s.seconds, 0),
    bufferSeconds: totalBuffer(input), precision, reason, attempts, suggestedCheck, currentCheck, conflicts };
}
