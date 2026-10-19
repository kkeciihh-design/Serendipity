import type { PlanEvent } from "./plan";

export type TimelinePresentation = {
  level: "experience" | "compact";
  category: "sight" | "food" | "stay" | "transit" | "rest" | "preparation";
  label: string;
};

// Models occasionally file routine transitions as activities. Use explicit
// transition wording as well as the event type so those still read as pauses.
const preparationTitle = /^(?:出发前|返程前|酒店|回酒店|返回酒店)?(?:整理行李|收拾行李|行李整理|打包行李|出行准备|退房|寄存行李|行李寄存)/;
const restTitle = /^(?:午后休整|午间休整|午间休息|午休|稍作休息|返回酒店休息|回酒店休息|自由休息)/;
const transitTitle = /^(?:前往|抵达|到达|离开|返回|往返).{0,8}(?:车站|火车站|高铁站|东站|西站|南站|北站|机场|站$)|^(?:从)?.{0,8}(?:车站|火车站|高铁站|东站|西站|南站|北站|机场)(?:出发|前往|到|至)|^(?:乘坐|搭乘|换乘)(?:地铁|公交|公共汽车|高铁|动车|列车|火车|机场大巴|出租车|网约车|的士|\d+路)|^(?:市内接驳|步行前往|打车前往|地铁前往)/;
const breakfastTitle = /早餐|早饭|早膳|breakfast/i;

/** Only the initial, explicitly pre-departure chores belong in a briefing. */
export function predepartureBriefingIds(events: PlanEvent[]): Set<string> {
  const firstJourney = [...events]
    .filter((event) => event.dayNumber === 1 && event.type === "departure_transport")
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
  const cutoff = firstJourney?.startTime ?? "09:00";
  return new Set(events.filter((event) => event.dayNumber === 1 && event.endTime <= cutoff && (
    event.type === "preparation" ||
    /^(?:出发前准备|出行准备|出发前整理行李)/.test(event.title) ||
    (/(?:出发地|家中|在家|出发前)/.test(event.title) && /(?:早餐|早饭)/.test(event.title))
  ) && !["departure_transport", "local_transport", "return_transport", "accommodation"].includes(event.type)).map((event) => event.id));
}

export function timelinePresentation(event: Pick<PlanEvent, "type" | "title" | "startTime">): TimelinePresentation {
  if (["departure_transport", "local_transport", "return_transport"].includes(event.type)) {
    return { level: "compact", category: "transit", label: event.type === "departure_transport" ? "去程" : event.type === "return_transport" ? "返程" : "接驳" };
  }
  if (event.type === "accommodation") {
    return { level: "experience", category: "stay", label: "住宿" };
  }
  if (event.type === "preparation") {
    return { level: "compact", category: "preparation", label: "准备" };
  }
  if (event.type === "rest") {
    return { level: "compact", category: "rest", label: "休整" };
  }
  if (event.type === "meal") {
    const breakfast = breakfastTitle.test(event.title) || Number(event.startTime.slice(0, 2)) < 10;
    return { level: breakfast ? "compact" : "experience", category: "food", label: breakfast ? "早餐" : "美食" };
  }
  // Fallback wording only repairs activities, never an explicit hotel or meal.
  // "乘坐" on its own also describes core experiences such as a lake cruise.
  if (preparationTitle.test(event.title)) {
    return { level: "compact", category: "preparation", label: "准备" };
  }
  if (restTitle.test(event.title)) {
    return { level: "compact", category: "rest", label: "休整" };
  }
  if (transitTitle.test(event.title)) {
    return { level: "compact", category: "transit", label: "接驳" };
  }
  return { level: "experience", category: "sight", label: /街区|老街|古街|坊街|步行街/.test(event.title) ? "街区" : "景点" };
}
