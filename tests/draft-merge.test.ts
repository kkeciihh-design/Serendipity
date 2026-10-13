import { describe, expect, it } from "vitest";
import { mergeVersionedDraft, type VersionedDraft } from "../lib/draft-merge";

const base = { note: "saved", startTime: "10:00", locked: false };
const entry = (value = base): VersionedDraft<typeof base> => ({ version: "v1", base, value, conflicts: [] });

describe("drafts survive another editor saving a plan version", () => {
  it("carries dirty fields to an otherwise unchanged new version", () => {
    const next = mergeVersionedDraft(entry({ ...base, note: "bring water" }), { ...base }, "v2");
    expect(next.value.note).toBe("bring water");
    expect(next.base.note).toBe("saved");
    expect(next.version).toBe("v2");
    expect(next.conflicts).toEqual([]);
  });

  it("adopts incoming changes only for fields the user has not edited", () => {
    const next = mergeVersionedDraft(entry({ ...base, note: "bring water" }), { ...base, startTime: "11:00", locked: true }, "v2");
    expect(next.value).toEqual({ note: "bring water", startTime: "11:00", locked: true });
    expect(next.conflicts).toEqual([]);
  });

  it("keeps the user's value and identifies a same-field conflict until resolved", () => {
    const conflicting = mergeVersionedDraft(entry({ ...base, note: "bring water" }), { ...base, note: "bring umbrella" }, "v2");
    expect(conflicting.value.note).toBe("bring water");
    expect(conflicting.conflicts).toEqual(["note"]);
    const later = mergeVersionedDraft(conflicting, { ...conflicting.base, locked: true }, "v3");
    expect(later.value).toEqual({ note: "bring water", startTime: "10:00", locked: true });
    expect(later.conflicts).toEqual(["note"]);
  });

  it("becomes clean when the server confirms the user's saved fields", () => {
    const value = { ...base, note: "bring water" };
    const saved = mergeVersionedDraft(entry(value), { ...value }, "v2");
    expect(saved.value).toEqual(saved.base);
    expect(saved.conflicts).toEqual([]);
    expect(mergeVersionedDraft(saved, { ...value, note: "new server note" }, "v3").value.note).toBe("new server note");
  });

  it("keeps the pending note when only unlocking has been saved", () => {
    const lockedBase = { ...base, locked: true };
    const previous = { version: "v2", base: lockedBase, value: { ...lockedBase, locked: false, note: "pending note" }, conflicts: [] };
    const next = mergeVersionedDraft(previous, { ...lockedBase, locked: false }, "v3");
    expect(next.value).toEqual({ ...base, note: "pending note", locked: false });
    expect(next.base.note).toBe("saved");
    expect(next.conflicts).toEqual([]);
  });

  it("uses canonical money values without losing an unsaved different amount", () => {
    const original = { amount: "300", unit: "per_night" };
    const previous: VersionedDraft<typeof original> = { version: "v1", base: original, value: { ...original, amount: "300.00" }, conflicts: [] };
    const next = mergeVersionedDraft(previous, { ...original, amount: "320" }, "v2", (field, left, right) => field === "amount" ? Number(left) === Number(right) : left === right);
    expect(next.value.amount).toBe("320");
    expect(next.conflicts).toEqual([]);
    const dirty = mergeVersionedDraft({ ...previous, value: { ...original, amount: "310" } }, original, "v2");
    expect(dirty.value.amount).toBe("310");
  });
});
