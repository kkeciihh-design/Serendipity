import { describe, expect, it } from "vitest";
import { predepartureBriefingIds, timelinePresentation } from "../lib/timeline-presentation";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import type { PlanEvent } from "../lib/plan";

const present = (type: PlanEvent["type"], title: string, startTime = "12:00") =>
  timelinePresentation({ type, title, startTime });

describe("timeline presentation", () => {
  it("limits the briefing to initial chores and explicit origin breakfast, preserving all daytime stops", () => {
    const { events } = planFixture(requestFixture(3));
    const departure = events.find((event) => event.id === "departure")!;
    departure.startTime = "08:00";
    const originBreakfast = { ...events.find((event) => event.id === "d1-breakfast")!, id: "origin-breakfast", title: "早餐 · 出发地简单的豆浆饭团", startTime: "07:00", endTime: "07:30" };
    events.push(originBreakfast);
    expect([...predepartureBriefingIds(events)]).toEqual(["d1-preparation", "origin-breakfast"]);
    const sightseeing = { ...originBreakfast, id: "early-sight", type: "activity" as const, title: "西湖晨游" };
    const transfer = { ...originBreakfast, id: "early-transfer", type: "local_transport" as const, title: "出发前准备接驳" };
    expect([...predepartureBriefingIds([sightseeing, transfer])]).toEqual([]);
  });
  it("keeps attractions, neighbourhoods, main meals and hotel stays prominent", () => {
    expect(present("activity", "西湖湖畔漫步")).toMatchObject({ level: "experience", category: "sight" });
    expect(present("activity", "河坊街漫游")).toMatchObject({ level: "experience", label: "街区" });
    expect(present("meal", "片儿川午餐")).toMatchObject({ level: "experience", category: "food" });
    expect(present("meal", "特色晚餐", "18:30")).toMatchObject({ level: "experience", category: "food" });
    expect(present("accommodation", "入住湖畔酒店", "20:00")).toMatchObject({ level: "experience", category: "stay" });
  });

  it("compresses transfers, routine pauses and breakfast even when AI types are imprecise", () => {
    for (const type of ["departure_transport", "local_transport", "return_transport"] as const) {
      expect(present(type, "交通安排")).toMatchObject({ level: "compact", category: "transit" });
    }
    for (const title of ["整理行李", "行李寄存", "退房后整理行李"]) {
      expect(present("activity", title)).toMatchObject({ level: "compact", category: "preparation" });
    }
    for (const title of ["午后休整", "午休", "返回酒店休息"]) {
      expect(present("activity", title)).toMatchObject({ level: "compact", category: "rest" });
    }
    for (const title of ["车站前往片区", "前往杭州东站", "步行前往车站", "从杭州东站前往西湖", "搭乘地铁前往博物馆", "乘坐公交前往缆车站"]) {
      expect(present("activity", title)).toMatchObject({ level: "compact", category: "transit" });
    }
    expect(present("meal", "早餐", "10:30")).toMatchObject({ level: "compact", label: "早餐" });
    expect(present("meal", "街边面馆", "07:30")).toMatchObject({ level: "compact", label: "早餐" });
  });

  it("does not demote a station-themed attraction or an early sightseeing stop", () => {
    expect(present("activity", "老火车站历史展览", "08:00").level).toBe("experience");
    expect(present("activity", "西湖晨游", "06:30").level).toBe("experience");
  });

  it("keeps scenic transport and explicit hotel stays as core experiences", () => {
    for (const title of ["乘坐西湖游船赏景", "搭乘热气球体验", "乘坐缆车到达山顶站", "搭乘观光巴士体验", "游览小镇，午休后继续"]) {
      expect(present("activity", title)).toMatchObject({ level: "experience", category: "sight" });
    }
    expect(present("accommodation", "入住酒店，次日12点退房")).toMatchObject({ level: "experience", category: "stay" });
    expect(present("meal", "退房后的杭帮菜午餐")).toMatchObject({ level: "experience", category: "food" });
  });
});
