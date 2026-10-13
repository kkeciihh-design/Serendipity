export type DraftFieldEqual<T extends object> = (field: keyof T, left: T[keyof T], right: T[keyof T]) => boolean;
export type VersionedDraft<T extends object> = {
  version: string;
  base: T;
  value: T;
  conflicts: (keyof T)[];
};

export function mergeVersionedDraft<T extends object>(
  previous: VersionedDraft<T>,
  incoming: T,
  version: string,
  equal: DraftFieldEqual<T> = (_field, left, right) => Object.is(left, right),
): VersionedDraft<T> {
  const value = { ...incoming };
  const conflicts: (keyof T)[] = [];
  for (const field of Object.keys(incoming) as (keyof T)[]) {
    const localChanged = !equal(field, previous.value[field], previous.base[field]);
    if (!localChanged || equal(field, previous.value[field], incoming[field])) continue;
    value[field] = previous.value[field];
    if (previous.conflicts.includes(field) || !equal(field, incoming[field], previous.base[field])) {
      conflicts.push(field);
    }
  }
  return { version, base: incoming, value, conflicts };
}
