import type { PlanEvent } from "./plan";

// A main-transport event currently has only its departure-place identity.
// Its end time cannot turn that place into the arrival station.
export function cityRouteOriginIssue(event: Pick<PlanEvent, "type"> | undefined) {
  return event?.type === "departure_transport" || event?.type === "return_transport"
    ? "主交通的地图地点是出发站，不能作为到站后的路线起点；请在门到门交通中核对后段接驳。"
    : null;
}
