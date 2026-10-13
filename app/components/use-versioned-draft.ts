"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeVersionedDraft, type DraftFieldEqual, type VersionedDraft } from "@/lib/draft-merge";

const equalField = <T extends object>(_field: keyof T, left: T[keyof T], right: T[keyof T]) => Object.is(left, right);

export function useVersionedDraft<T extends object>({ scope, version, itemId, source, equal = equalField }: {
  scope: string;
  version: string;
  itemId: string | null;
  source: T | null;
  equal?: DraftFieldEqual<T>;
}) {
  const cache = useRef(new Map<string, VersionedDraft<T>>());
  const activeScope = useRef(scope);
  const [draft, setDraftState] = useState<T | null>(source);
  const [conflicts, setConflicts] = useState<(keyof T)[]>([]);

  useEffect(() => {
    if (activeScope.current !== scope) {
      cache.current.clear();
      activeScope.current = scope;
    }
    if (!itemId || !source) {
      setDraftState(null);
      setConflicts([]);
      return;
    }
    const previous = cache.current.get(itemId);
    const next = previous ? mergeVersionedDraft(previous, source, version, equal)
      : { version, base: source, value: source, conflicts: [] };
    cache.current.set(itemId, next);
    setDraftState(next.value);
    setConflicts(next.conflicts);
  }, [scope, version, itemId, source, equal]);

  const setDraft = useCallback((next: T) => {
    if (!itemId || !source) return;
    const previous = cache.current.get(itemId);
    const base = previous?.base ?? source;
    const unresolved = (previous?.conflicts ?? []).filter((field) => !equal(field, next[field], base[field]));
    cache.current.set(itemId, { version, base, value: next, conflicts: unresolved });
    setDraftState(next);
    setConflicts(unresolved);
  }, [itemId, source, version, equal]);

  const acknowledgeSaved = useCallback((savedId: string, savedSource: T, savedVersion: string) => {
    cache.current.set(savedId, { version: savedVersion, base: savedSource, value: savedSource, conflicts: [] });
    if (savedId === itemId) {
      setDraftState(savedSource);
      setConflicts([]);
    }
  }, [itemId]);

  const resetDraft = useCallback(() => {
    if (itemId && source) acknowledgeSaved(itemId, source, version);
  }, [itemId, source, version, acknowledgeSaved]);

  return { draft, setDraft, resetDraft, acknowledgeSaved, conflicts };
}
