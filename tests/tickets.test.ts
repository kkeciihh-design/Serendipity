import { describe, expect, it } from "vitest";
import { normalizePlanOutput, nextPlanDate } from "../lib/plan";
import {
  activateTicket, applyTicketsToEvents, cancelTicket, createDraftTicket, replaceTicket,
  isTicketAccessEvent, ticketActionSchema, ticketChain, ticketWarnings, updateTicketDetails, validateTickets,
} from "../lib/tickets";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { ticketFixture } from "./helpers/ticket-fixtures";

describe("manual ticket facts and chain timing", () => {
  const snapshot = requestFixture();
  const date = snapshot.startDate!;
  const events = planFixture(snapshot).events;

  it("accepts incomplete confirmed facts without inventing arrival or airline cutoffs", () => {
    const ticket = ticketFixture(date, { mode: "flight", arrivalDate: null, arrivalTime: null, boardingCutoffMinutes: null });
    expect(ticketActionSchema.safeParse({ action: "activate", acknowledged: true, ticket }).success).toBe(true);
    const active = activateTicket(ticket);
    const applied = applyTicketsToEvents(events, [active]);
    expect(applied.find((event) => event.id === "departure")).toMatchObject({ locked: true, ticketTimingPending: true });
    expect(ticketChain(ticket)).toMatchObject({ arrivalAt: null, hubReadyAt: null, originDepartureAt: null });
    expect(ticketWarnings(active).join(" ")).toContain("到达日期");
    expect(ticketWarnings(active).join(" ")).toContain("值机、托运、登机截止待确认");
  });

  it("counts the strongest cutoff and extra buffer once, with previous-day access and next-day arrival", () => {
    const ticket = ticketFixture(date, { mode: "flight", departureTime: "00:30", arrivalDate: nextPlanDate(date),
      arrivalTime: "00:10", accessDurationMinutes: 30, egressDurationMinutes: 50,
      checkInCutoffMinutes: 60, bagDropCutoffMinutes: 45, boardingCutoffMinutes: 20, bufferMinutes: 10 });
    const chain = ticketChain(ticket);
    expect(Date.parse(chain.departureAt!) - Date.parse(chain.originDepartureAt!)).toBe(100 * 60_000);
    expect(Date.parse(chain.destinationArrivalAt!) - Date.parse(chain.arrivalAt!)).toBe(50 * 60_000);
    const applied = applyTicketsToEvents(events, [activateTicket(ticket)]);
    expect(applied.find((event) => event.id === "departure")).toMatchObject({ date, endDate: nextPlanDate(date), endTime: "00:10", ticketTimingPending: false });
  });

  it("keeps draft and historical tickets outside constraints and keeps previous confirmation time", () => {
    expect(applyTicketsToEvents(events, [createDraftTicket(ticketFixture(date))])).toEqual(events);
    const active = activateTicket(ticketFixture(date));
    const cancelled = cancelTicket(active);
    expect(cancelled.confirmedAt).toBe(active.confirmedAt);
    expect(applyTicketsToEvents(applyTicketsToEvents(events, [active]), [cancelled]).find((event) => event.id === "departure"))
      .toMatchObject({ status: "suggested", locked: false, ticketManaged: false });
    expect(validateTickets([], events)).toEqual({ errors: [], warnings: [] });
  });

  it("protects the other active shared ticket and flags station/terminal or service conflicts", () => {
    const first = activateTicket(ticketFixture(date));
    const second = activateTicket(ticketFixture(date));
    const { replaced, replacement } = replaceTicket(first, ticketFixture(date, { fromDetail: "另一航站楼 T2" }));
    expect(replaced).toMatchObject({ confirmedAt: first.confirmedAt, replacedByTicketId: replacement.id });
    const tickets = [replaced, second, replacement];
    expect(validateTickets(tickets, events).warnings.join(" ")).toContain("单线行程无法同时表达");
    expect(applyTicketsToEvents(events, tickets).find((event) => event.id === "departure"))
      .toMatchObject({ locked: true, ticketTimingPending: true, title: "去程：多班次冲突" });
    expect(validateTickets([{ ...first, confirmedAt: null }], events).errors.join(" ")).toContain("确认时间");
    const located = events.map((event) => event.id === "departure" ? { ...event, locationName: first.fromName, placeId: "terminal-1" } : event);
    expect(applyTicketsToEvents(located, [replaced, replacement], [first]).find((event) => event.id === "departure")?.placeId).toBeNull();
  });

  it("flags impossible connections, return last-service uncertainty and unknown driving costs", () => {
    const active = activateTicket(ticketFixture(date, { accessDurationMinutes: 40, accessFareCents: null,
      egressDurationMinutes: 90, direction: "return", eventId: "return", egressMode: "public_transit" }));
    const warnings = ticketWarnings(active, events).join(" ");
    expect(warnings).toContain("无法衔接");
    expect(warnings).toContain("末班车");
    expect(warnings).toContain("返程到站后回家");
    expect(warnings).toContain("自驾接驳费用待确认");
    const missingCutoff = activateTicket(ticketFixture(date, { boardingCutoffMinutes: null }));
    expect(ticketChain(missingCutoff).originDepartureAt).toBeNull();
    expect(ticketWarnings(missingCutoff).join(" ")).toContain("检票截止待确认");
  });

  it("retains contradictory real timestamps as warnings and strips model ticket authority", () => {
    const active = activateTicket(ticketFixture(date, { arrivalTime: "06:00" }));
    expect(validateTickets([active], events).errors).toEqual([]);
    expect(ticketWarnings(active).join(" ")).toContain("冲突");
    expect(applyTicketsToEvents(events, [active]).find((event) => event.id === "departure")?.ticketTimingPending).toBe(true);
    const content = planFixture(snapshot);
    content.events[0].ticketManaged = true;
    content.events[0].ticketTimingPending = true;
    expect(normalizePlanOutput(content).events.every((event) => !event.ticketManaged && !event.ticketTimingPending)).toBe(true);
  });

  it("rejects contradictory new ticket times before save and permits correcting a legacy invalid time in place", () => {
    const invalid = ticketFixture(date, { departureTime: "16:00", arrivalTime: "15:00" });
    for (const action of ["create_draft", "activate"] as const) {
      const parsed = ticketActionSchema.safeParse({ action, acknowledged: true, ticket: invalid });
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues[0].message).toContain("到达时间必须晚于出发时间");
    }
    expect(ticketActionSchema.safeParse({ action: "activate", acknowledged: true,
      ticket: { ...invalid, arrivalDate: nextPlanDate(date) } }).success).toBe(true);
    const legacy = activateTicket(invalid);
    expect(updateTicketDetails(legacy, { ...invalid, arrivalTime: "20:30" })).toMatchObject({
      id: legacy.id, confirmedAt: legacy.confirmedAt, arrivalTime: "20:30", status: "active",
    });
  });

  it("merges the existing station wait into the ticket chain without excluding independent travel", () => {
    const returning = events.find((event) => event.id === "return")!;
    const ticket = activateTicket(ticketFixture(returning.date, { eventId: returning.id, direction: "return",
      fromName: "泉州站", toName: "深圳北站", departureTime: "16:00", arrivalTime: "20:30", accessDurationMinutes: 30 }));
    const access = { ...returning, id: "quanzhou-station-access", type: "local_transport" as const,
      title: "打车至泉州站并候车", locationName: "泉州站", startTime: "13:00", endTime: "16:00", locked: false, status: "suggested" as const };
    expect(isTicketAccessEvent(access, ticket)).toBe(true);
    expect(isTicketAccessEvent({ ...access, title: "从泉州站打车至酒店", locationName: "西街酒店" }, ticket)).toBe(false);
    expect(isTicketAccessEvent({ ...access, title: "打车去开元寺", locationName: "开元寺" }, ticket)).toBe(false);
    expect(isTicketAccessEvent({ ...access, locked: true }, ticket)).toBe(false);
    const before = [access, returning];
    const after = applyTicketsToEvents(before, [ticket]);
    expect(after[0]).toMatchObject({ id: access.id, ticketAccessForEventId: returning.id, ticketManaged: true });
    expect(ticketWarnings(ticket, after).join()).not.toContain("上一项");
    expect(applyTicketsToEvents(after, [cancelTicket(ticket)])[0].ticketAccessForEventId).toBeUndefined();
    expect(applyTicketsToEvents(after, [cancelTicket(ticket)])[0].ticketManaged).toBe(false);
  });
});
