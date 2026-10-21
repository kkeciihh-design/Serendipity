import { describe, expect, it } from "vitest";
import { checklistItemSchema } from "../lib/checklist";
import { projectPreparation } from "../lib/export-preparation";
import { renderMobileHtml } from "../lib/mobile-export";
import { mobileExportOptionsSchema } from "../lib/export-snapshot";
import { exportFixture } from "./helpers/export-fixtures";

async function quanzhouPreparation() {
  const snapshot = await exportFixture(3);
  const dates = [snapshot.plan.requestSnapshot.startDate!, snapshot.plan.events.find((event) => event.dayNumber === 2)!.date, snapshot.plan.requestSnapshot.endDate!];
  const rows = [
    ["out", "departure_transport", "深圳北站", "去程票：核对日期、站点与同行人数", "transport", dates[0]],
    ["stay1", "accommodation", "西街钟楼住宿片区", "确认住宿：西街钟楼住宿片区", "accommodation", dates[0]],
    ["flower", "activity", "蟳埔村", "确认是否需要预约：蟳埔村", "reservation", dates[1]],
    ["museum", "activity", "泉州海外交通史博物馆", "确认是否需要预约：泉州海外交通史博物馆", "reservation", dates[1]],
    ["stay2", "accommodation", "西街钟楼住宿片区", "确认住宿：西街钟楼住宿片区", "accommodation", dates[1]],
    ["back", "return_transport", "泉州站", "返程票：核对日期、站点与同行人数", "transport", dates[2]],
  ] as const;
  snapshot.plan.events = rows.map(([id, type, locationName, title, , date]) => ({ ...snapshot.plan.events[0], id, type, locationName, title, date }));
  snapshot.checklist.items = rows.map(([id, , , title, group, date]) => checklistItemSchema.parse({
    id, title, group, date, eventId:id, eventIds:[id], ticketIds:[], note:"", source:"event", sourceLabel:"合成清单", sourceKey:id,
    signature:id, officialUrl:null, custom:false, completed:false, completedAt:null, deleted:false, orphaned:false, changeNote:null,
  }));
  snapshot.plan.pendingItems = [
    {id:"train",category:"transport_ticket",title:"预订深圳北—泉州、泉州—深圳北高铁票",reason:"核实12306班次与票价",requiredBefore:"2026-10-01"},
    {id:"flower",category:"reservation",title:"预约蟳埔村簪花围体验与跟拍",reason:"确认价格与集合点",requiredBefore:"2026-10-01"},
    {id:"museum",category:"route",title:"核对泉州海外交通史博物馆的最新安排",reason:"确认开放时间、闭馆日与预约",requiredBefore:"2026-10-01"},
    {id:"stay",category:"accommodation",title:"预订西街钟楼或开元寺附近住宿2晚",reason:"确认寄存行李与退房时间",requiredBefore:"2026-10-01"},
    {id:"independent",category:"route",title:"雨天核对博物馆往返接驳",reason:"确认末班车与打车集合点",requiredBefore:null},
  ];
  snapshot.plan.validationResults.errors = []; snapshot.plan.validationResults.warnings = [];
  return {snapshot, dates, selected:new Set(rows.map(([id])=>id))};
}

describe("preparation reminder coverage", () => {
  it("omits a repeated generic hotel-storage sentence after an existing storage check", async () => {
    const { snapshot, dates, selected } = await quanzhouPreparation();
    snapshot.checklist.items.find((item) => item.id === "stay1")!.note = "核对预订、入住及行李寄存条件。联系酒店确认寄存时段、费用和大件限制，或安排其他寄存点。";
    const stay = projectPreparation(snapshot, dates, selected, dates).find((entry) => entry.title === "西街钟楼片区住宿")!;
    expect(stay.note.join(" ").match(/寄存/g)).toHaveLength(1);
    expect(stay.note.join(" ")).not.toContain("联系酒店确认");
  });
  it("shortens titles and removes repeated instructions and internal status text", async () => {
    const { snapshot, dates, selected } = await quanzhouPreparation();
    const item = snapshot.checklist.items.find((row) => row.id === "flower")!;
    item.note = "提前核对预约价格与集合点。关联日期、安排或票据已变化，请重新核对。";
    item.changeNote = "关联日期、安排或票据已变化，请重新核对。";
    const entries = projectPreparation(snapshot, dates, selected, dates);
    const flower = entries.find((entry) => entry.title === "蟳埔村预约核对")!;
    expect(flower.note.join(" ")).not.toContain("关联日期");
    expect(flower.note.filter((note) => note.includes("集合点"))).toHaveLength(1);
    expect(flower.changeNote).toBeNull();
    expect(entries.filter((entry) => entry.title === "西街钟楼片区住宿")).toHaveLength(2);
  });
  it("enriches the existing ticket, lodging and reservation checkboxes and keeps independent reminders", async () => {
    const {snapshot,dates,selected} = await quanzhouPreparation();
    const entries = projectPreparation(snapshot,dates,selected,dates);
    expect(entries.filter((entry)=>entry.checkbox)).toHaveLength(6);
    expect(entries.filter((entry)=>!entry.checkbox).map((entry)=>entry.title)).toEqual(["雨天核对博物馆往返接驳"]);
    expect(entries.some((entry)=>entry.note.some((note)=>note.includes("12306")))).toBe(true);
    const html = renderMobileHtml(snapshot,mobileExportOptionsSchema.parse({})).split('<section id="preparation">')[1];
    for (const pending of snapshot.plan.pendingItems.slice(0,4)) expect(html).not.toContain(pending.title);
    expect(html).toContain("雨天核对博物馆往返接驳");
  });
  it("retains a round-trip reminder if only the departure checkbox is covered", async () => {
    const {snapshot,dates,selected} = await quanzhouPreparation();
    snapshot.checklist.items = snapshot.checklist.items.filter((item)=>item.id!=="back");
    expect(projectPreparation(snapshot,dates,selected,dates).some((entry)=>entry.title===snapshot.plan.pendingItems[0].title)).toBe(true);
  });
  it("keeps a reservation note only once when the pending item adds its deadline", async () => {
    const {snapshot,dates,selected} = await quanzhouPreparation();
    snapshot.checklist.items.find((item)=>item.id==="flower")!.note = "确认价格与集合点";
    const flower = projectPreparation(snapshot,dates,selected,dates).find((entry)=>entry.title.includes("蟳埔村"))!;
    expect(flower.note.join(" ").match(/确认价格与集合点/g)).toHaveLength(1);
    expect(flower.note.join(" ")).toContain("2026-10-01");
  });
  it("does not merge confirmations for two different hotel nights", async () => {
    const {snapshot,dates,selected} = await quanzhouPreparation();
    const stays = projectPreparation(snapshot,dates,selected,dates).filter((entry)=>entry.title === "西街钟楼片区住宿");
    expect(stays).toHaveLength(2); expect(stays[0].date).not.toBe(stays[1].date);
  });
  it("preserves different booking requirements even when their topics overlap", async () => {
    const { snapshot, dates, selected } = await quanzhouPreparation();
    snapshot.checklist.items.find((item) => item.id === "flower")!.note = "预约通过微信公众号办理。";
    snapshot.plan.pendingItems.find((item) => item.id === "flower")!.reason = "预约还需电话联系摄影师。";
    const flower = projectPreparation(snapshot, dates, selected, dates).find((entry) => entry.title === "蟳埔村预约核对")!;
    expect(flower.note.join(" ")).toContain("微信公众号");
    expect(flower.note.join(" ")).toContain("电话联系摄影师");
  });
  it("keeps concrete train-booking instructions alongside an existing ticket note", async () => {
    const { snapshot, dates, selected } = await quanzhouPreparation();
    snapshot.checklist.items.find((item) => item.id === "out")!.note = "12306 核对班次、站点与票面。";
    snapshot.plan.pendingItems.find((item) => item.id === "train")!.reason = "12306 候补车票需开启同车次不同席别组合。";
    const departure = projectPreparation(snapshot, dates, selected, dates).find((entry) => entry.title === "去程车票核对")!;
    expect(departure.note.join(" ")).toContain("同车次不同席别组合");
  });
  it("combines overlapping hotel checks without repeating luggage storage", async () => {
    const { snapshot, dates, selected } = await quanzhouPreparation();
    snapshot.checklist.items.find((item) => item.id === "stay1")!.note = "核对预订、入住及行李寄存条件。";
    snapshot.plan.pendingItems.find((item) => item.id === "stay")!.reason = "核对寄存、隔音、退房及两晚住宿预算。";
    const stay = projectPreparation(snapshot, dates, selected, dates).find((entry) => entry.title === "西街钟楼片区住宿")!;
    const notes = stay.note.join(" ");
    expect(notes.match(/寄存/g)).toHaveLength(1);
    for (const detail of ["预订", "入住", "隔音", "退房", "两晚住宿预算"]) expect(notes).toContain(detail);
  });
});
