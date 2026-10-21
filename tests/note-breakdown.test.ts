import { describe, expect, it } from "vitest";
import { breakdownNote, noteLeadIn } from "@/lib/note-breakdown";

describe("breakdownNote", () => {
  it("separates a ticket sentence from an hours sentence", () => {
    const note = "开元寺是泉州最大的佛教寺院。门票免费，但需提前预约。开放时间 8:00–17:30，游览约 1.5 小时。";
    const result = breakdownNote(note);
    expect(result.plain).toBe(false);
    expect(result.lead).toContain("开元寺是泉州最大的佛教寺院");
    expect(result.parts.map((part) => part.kind)).toEqual(["ticket", "hours"]);
    expect(result.parts[0].label).toBe("门票/预约");
    expect(result.parts[0].text).toContain("门票免费");
    expect(result.parts[1].text).toContain("开放时间");
  });

  it("keeps every character of the source text", () => {
    const note = "西街是泉州最古老的街区。建议傍晚前往避开人流高峰。";
    const result = breakdownNote(note);
    const rebuilt = [result.lead, ...result.parts.map((part) => part.text)].join(" ").replace(/\s+/g, "");
    expect(rebuilt).toBe(note.replace(/\s+/g, ""));
  });

  it("falls back to a plain paragraph for a single short sentence", () => {
    const result = breakdownNote("顺路吃一碗面线糊。");
    expect(result.plain).toBe(true);
    expect(result.lead).toBe("顺路吃一碗面线糊。");
    expect(result.parts).toEqual([]);
  });

  it("falls back when no sentence matches a known category", () => {
    const note = "姜母鸭是本地名菜。老店多在巷子深处。";
    const result = breakdownNote(note);
    expect(result.plain).toBe(true);
    expect(result.lead).toBe(note);
  });

  it("does not lose unrecognised sentences when some match", () => {
    const note = "寺院格局开阔。老店多在巷子深处。建议清晨前往，光线最好。";
    const result = breakdownNote(note);
    expect(result.plain).toBe(false);
    // The unmatched sentence is preserved in the lead-in, not discarded.
    expect(result.lead).toContain("老店多在巷子深处");
    expect(result.lead).toContain("寺院格局开阔");
  });

  it("handles empty and null notes", () => {
    expect(breakdownNote(null)).toEqual({ lead: "", parts: [], plain: true });
    expect(breakdownNote("   ")).toEqual({ lead: "", parts: [], plain: true });
  });

  it("caps the cells at three so a card never becomes a wall again", () => {
    const note = "介绍。门票 40 元，可预约。开放到 17:00，约 2 小时。建议早上前往避开人流。";
    expect(breakdownNote(note).parts.length).toBeLessThanOrEqual(3);
  });
});

describe("noteLeadIn", () => {
  it("returns a short lead untouched", () => {
    expect(noteLeadIn({ lead: "开元寺是泉州最大的寺院。", parts: [], plain: false })).toBe("开元寺是泉州最大的寺院。");
  });

  it("clips on a clause boundary and marks the elision", () => {
    const long = "西街是泉州最古老的街区之一，也是古城烟火气最浓的地方，两旁骑楼与老字号密布，适合慢走细看。";
    const result = noteLeadIn({ lead: long, parts: [], plain: false }, 30);
    expect(result.length).toBeLessThanOrEqual(31);
    expect(result.endsWith("…")).toBe(true);
  });
});
