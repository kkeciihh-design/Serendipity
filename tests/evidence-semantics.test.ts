import { describe, expect, it } from "vitest";
import { collectEvidence } from "../lib/evidence-source";
import { effectiveEvidenceStatus, extractEvidence, reservationRequirement, summarizeEventEvidence, type EvidenceFactClient, type EvidenceField } from "../lib/evidence";
import { evidenceTarget, evidenceTargetSignature, type EvidenceTarget } from "../lib/evidence-evaluation";
import { derivePlanCosts } from "../lib/budget";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
function targetFixture(changes: Partial<EvidenceTarget["event"]> = {}): EvidenceTarget {
  const event = planFixture(requestFixture(2)).events.find((item) => item.id === "d1-activity")!;
  Object.assign(event, { date: "2026-11-01", endDate: "2026-11-01", locationName: "10 Museum Road", note: "Reservations are required." }, changes);
  const costs = derivePlanCosts([event]);
  costs[0] = { ...costs[0], category: "ticket", unit: "per_person", unitAmountCents: 1800 };
  return evidenceTarget(event, costs);
}

async function read(field: EvidenceField, body: string, options: {
  target?: EvidenceTarget; validity?: string; title?: string; metadata?: string;
} = {}) {
  const target = options.target ?? targetFixture();
  const validity = options.validity ?? "Valid from 2026-10-01 to 2026-11-30";
  return collectEvidence({
    field, query: "Example Museum visitor information", officialHost: "example.com", eventDate: target.event.date, target,
    lookupImpl: publicLookup,
    fetchImpl: async (url) => new Response(url.startsWith("https://html.duckduckgo.com/")
      ? '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example.com%2Fvisit">Example Museum</a>'
      : `<title>${options.title ?? "Example Museum"}</title>${options.metadata ?? ""}<p>${validity}</p>${body}`,
    { headers: { "content-type": "text/html" } }),
  });
}

function fact(field: EvidenceField, overrides: Partial<EvidenceFactClient> = {}): EvidenceFactClient {
  return {
    id: field, targetType: "event", targetId: "museum", planVersionId: "v1", field,
    status: "verified", effectiveStatus: "verified", sourceTitle: "Example Museum", sourceUrl: "https://www.example.com/visit",
    sourcePublisher: "www.example.com", sourcePublishedAt: null, sourceDateStatus: "applicable", extractedValue: "supported value",
    contentQuote: "Explicit supported field value", searchProvider: "duckduckgo", searchQuery: "Example Museum",
    retrievedAt: "2026-10-01T00:00:00Z", applicableFrom: "2026-10-01T00:00:00Z", applicableUntil: "2999-11-30T00:00:00Z",
    lastRefreshAt: "2026-10-01T00:00:00Z", lastRefreshStatus: "success", lastRefreshError: null, conflictReason: null, ...overrides,
  };
}

describe("SD-05 field value, object and date semantics", () => {
  it.each(["", "Address:", "Address: TBD", "Address: unknown"])("does not match an empty or unknown address: %s", async (text) => {
    expect(extractEvidence("location", text).matched).toBe(false);
    const result = await read("location", `<p>${text}</p>`);
    expect(result).toMatchObject({ status: "unverified", readStatus: "read", extractedValue: "" });
  });

  it("compares the source address with the non-empty current location", async () => {
    expect((await read("location", "<p>Address: 10 Museum Road.</p>")).status).toBe("verified");
    expect((await read("location", "<p>Address: 99 Museum Road.</p>")).status).toBe("conflict");
    expect((await read("location", "<p>Address: 10 Museum Road.</p>", { target: targetFixture({ locationName: null }) })).status).toBe("unverified");
  });

  it("requires the actual page to identify the same object, not the search query", async () => {
    const result = await read("location", "<p>Address: 10 Museum Road.</p>", { title: "Another Museum" });
    expect(result.status).toBe("unverified");
    expect(result.conflictReason).toContain("目标对象");
  });

  it.each([
    ["Reservations are required.", "required"],
    ["Reservations are not required.", "not_required"],
    ["No booking is needed.", "not_required"],
    ["No reservations are required.", "not_required"],
    ["需要提前预约。", "required"],
    ["不需要提前预约。", "not_required"],
    ["Reservations are not always required.", null],
    ["It is not true that reservations are required.", null],
    ["Reservations are required only on weekends.", null],
    ["不必须预约。", null],
    ["It is false that reservations are required.", null],
    ["Reservations are required. MAY be waived.", null],
    ["Reservations are required. Reservations are not required.", null],
  ])("distinguishes a direct reservation rule from negation/uncertainty: %s", (text, expected) => {
    expect(reservationRequirement(text)).toBe(expected);
  });

  it("compares reservation polarity without claiming that a booking has been made", async () => {
    const negative = "<p>Reservations are not required.</p>";
    expect((await read("reservation", negative)).status).toBe("conflict");
    const supported = await read("reservation", negative, { target: targetFixture({ note: "无需预约。" }) });
    expect(supported).toMatchObject({ status: "verified", extractedValue: "not_required" });
    expect((await read("reservation", negative, { target: targetFixture({ note: null }) })).status).toBe("unverified");
    expect((await read("reservation", "<p>Reservations are required.</p><p>Only on Sundays.</p>")).status).toBe("unverified");
  });

  it.each([
    "<p>Opening hours daily 09:00–17:00.</p><p>Closed on Mondays.</p>",
    "<p>Opening hours daily 09:00–17:00.</p><p>Not open on Mondays.</p>",
    "<p>开放时间：周二至周日 09:00–17:00，周一闭馆。</p>",
  ])("rejects a Monday visit when the official rule closes on Monday", async (body) => {
    const target = targetFixture({ date: "2026-11-02", endDate: "2026-11-02" });
    expect((await read("opening_hours", body, { target })).status).toBe("conflict");
  });

  it("requires visit hours and last entry to agree with the arrangement", async () => {
    const body = "<p>Opening hours Tuesday to Sunday 09:00–17:00; last entry 16:00.</p>";
    expect((await read("opening_hours", body)).status).toBe("verified");
    expect((await read("opening_hours", body, { target: targetFixture({ startTime: "16:00", endTime: "17:00" }) })).status).toBe("conflict");
    expect((await read("opening_hours", body, { target: targetFixture({ endTime: "18:00" }) })).status).toBe("conflict");
    expect((await read("opening_hours", "<p>Opening hours 09:00–17:00.</p>")).status).toBe("unverified");
  });

  it("supports an explicit midnight-spanning opening range only within the source validity window", async () => {
    const target = targetFixture({ startTime: "23:00", endTime: "01:00", endDate: "2026-11-02" });
    expect((await read("opening_hours", "<p>Opening hours daily 22:00–02:00.</p>", { target })).status).toBe("verified");
    expect((await read("opening_hours", "<p>Opening hours daily 22:00–02:00.</p>", {
      target, validity: "Valid from 2026-10-01 to 2026-11-01",
    })).status).toBe("unverified");
  });

  it.each([
    ["Valid from 2026-01-01 to 2026-10-01", "outside_window"],
    ["Valid from 2026-12-01 to 2026-12-30", "outside_window"],
    ["", "date_unknown"],
    ["Published 2026-10-01", "date_unknown"],
    ["Valid from 2026-02-30 to 2026-11-30", "date_unknown"],
    ["Reservation policy valid from 2026-10-01 to 2026-11-30", "date_unknown"],
  ])("does not confuse publication or an inapplicable date range with validity: %s", async (validity, status) => {
    const result = await read("opening_hours", "<p>Opening hours daily 09:00–17:00.</p>", {
      validity, metadata: '<meta property="article:published_time" content="2026-10-01T00:00:00Z">',
    });
    expect(result).toMatchObject({ status: "unverified", sourceDateStatus: status, readStatus: "read" });
    expect(result.sourcePublishedAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("keeps undated content pending unless it independently states the applicable date range", async () => {
    const body = "<p>Opening hours daily 09:00–17:00.</p>";
    const undated = await read("opening_hours", body, { validity: "" });
    expect(undated).toMatchObject({ status: "unverified", sourcePublishedAt: null, sourceDateStatus: "date_unknown" });
    const explicitlyValid = await read("opening_hours", body);
    expect(explicitlyValid).toMatchObject({ status: "verified", sourcePublishedAt: null, sourceDateStatus: "applicable" });
    expect(explicitlyValid.applicableFrom?.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(explicitlyValid.applicableUntil?.toISOString()).toBe("2026-11-30T15:59:59.999Z");
  });

  it("compares price amount, unit, currency context and cost object", async () => {
    expect((await read("price", "<p>Ticket price CNY 18 per person.</p>")).status).toBe("verified");
    expect((await read("price", "<p>Ticket price CNY 20 per person.</p>")).status).toBe("conflict");
    for (const body of ["Ticket price CNY 18 per ticket.", "Ticket price is not CNY 18 per person.",
      "Children's ticket price CNY 18 per person.", "Cafe price CNY 18 per person.", "Ticket price $18 per person."]) {
      expect((await read("price", `<p>${body}</p>`)).status).toBe("unverified");
    }
    const target = targetFixture();
    target.price!.category = "accommodation";
    expect((await read("price", "<p>Ticket price CNY 18 per person.</p>", { target })).status).toBe("unverified");
  });

  it("records successful reads without relevant information separately from read failures", async () => {
    const result = await read("opening_hours", "<p>Welcome to the museum.</p>");
    expect(result).toMatchObject({ status: "unverified", readStatus: "read", extractedValue: "" });
    expect(result.contentQuote).toContain("Welcome");
  });

  it("honors last admission and keeps unparsed or conflicting limits pending", async () => {
    const late = targetFixture({ startTime: "16:00", endTime: "17:00" });
    const body = "<p>Opening hours daily 09:00–17:00; last admission 15:00.</p>";
    expect((await read("opening_hours", body, { target: late })).status).toBe("conflict");
    expect((await read("opening_hours", body)).status).toBe("verified");
    for (const limit of ["last admission varies", "last admission 15:00; last entry 16:00"]) {
      expect((await read("opening_hours", `<p>Opening hours daily 09:00–17:00; ${limit}.</p>`)).status).toBe("unverified");
    }
  });

  it.each([
    "Closed on Tuesdays and Wednesdays.", "Closed for maintenance.",
    "Temporary closure for maintenance.", "Seasonal closures apply.",
    "Closure on Tuesdays and Wednesdays.",
    "The museum will close for maintenance.", "The museum will temporarily close for maintenance.",
  ])("does not promote unparsed closure conditions: %s", async (closure) => {
    const target = targetFixture({ date: "2026-11-04", endDate: "2026-11-04" });
    const result = await read("opening_hours", `<p>Opening hours daily 09:00–17:00.</p><p>${closure}</p>`, { target });
    expect(result.status).toBe("unverified");
    expect(result.conflictReason).toContain("闭馆条件");
  });

  it("still supports an understood closure on a different weekday", async () => {
    expect((await read("opening_hours", "<p>Opening hours Tuesday to Sunday 09:00–17:00.</p><p>Closed on Mondays.</p>")).status).toBe("verified");
  });

  it("does not confuse an ordinary closing time with a closure condition", async () => {
    expect((await read("opening_hours", "<p>Opening hours daily 09:00–17:00.</p><p>Closing time 17:00.</p>")).status).toBe("verified");
  });

  it("keeps ticket evidence and its signature independent of the journey fare", async () => {
    const event = planFixture(requestFixture(2)).events.find((item) => item.id === "d1-activity")!;
    Object.assign(event, { date: "2026-11-01", endDate: "2026-11-01" });
    const ticket = { ...derivePlanCosts([event])[0], unit: "per_person" as const, unitAmountCents: 1800 };
    const fare = { ...ticket, id: "route-to-museum", category: "local_transport" as const, unitAmountCents: 600 };
    const before = evidenceTarget(event, [ticket]);
    const after = evidenceTarget(event, [ticket, fare]);
    expect(after.price).toEqual(before.price);
    expect(evidenceTargetSignature(after, "price")).toBe(evidenceTargetSignature(before, "price"));
    expect((await read("price", "<p>Ticket price CNY 18 per person.</p>", { target: after })).status).toBe("verified");
    const changed = evidenceTarget(event, [{ ...ticket, unitAmountCents: 1900 }, fare]);
    expect(evidenceTargetSignature(changed, "price")).not.toBe(evidenceTargetSignature(before, "price"));
    expect(evidenceTarget(event, [ticket, { ...ticket, id: "second-ticket" }, fare]).price).toBeNull();
    expect(evidenceTarget(event, [fare]).price).toBeNull();
  });
});

describe("SD-05 conservative card labels", () => {
  const fields: EvidenceField[] = ["opening_hours", "reservation", "price", "location"];
  it("counts verified fields without upgrading an entire card", () => {
    expect(summarizeEventEvidence([fact("location")])).toMatchObject({ status: "pending", label: "1/4 项字段已核验，其余待确认" });
    expect(summarizeEventEvidence(fields.map((field) => fact(field)))).toMatchObject({ status: "verified", verifiedCount: 4 });
  });
  it.each(["conflict", "stale"] as const)("does not conceal %s behind another verified field", (status) => {
    const issue = status === "conflict" ? { status: "conflict" as const } : { lastRefreshStatus: "failed" };
    expect(summarizeEventEvidence([fact("location"), fact("opening_hours", issue)])).toMatchObject({ status });
  });
  it("downgrades old page-only records on read without changing their stored history", () => {
    const legacy = fact("location", { extractedValue: "", sourceDateStatus: "undated" });
    const before = structuredClone(legacy);
    expect(effectiveEvidenceStatus(legacy)).toBe("pending");
    expect(legacy).toEqual(before);
  });
  it("labels sources outside the trip's applicable window as needing review", () => {
    expect(effectiveEvidenceStatus(fact("opening_hours", { status: "unverified", sourceDateStatus: "outside_window" }))).toBe("stale");
  });
});
