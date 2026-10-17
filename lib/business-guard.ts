import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getDatabasePath } from "./data-directory";
import { assertGeneration, readInstanceState, RestoreGuardError } from "../scripts/restore-core.mjs";

const global = globalThis as typeof globalThis & { serendipityGenerationScope?: AsyncLocalStorage<string> };
const scope = global.serendipityGenerationScope ??= new AsyncLocalStorage<string>();
export { RestoreGuardError };
export function capturedGeneration() {
  const generation = scope.getStore();
  if (!generation) throw new Error("业务操作必须先捕获数据代际。");
  return generation;
}
export function assertCapturedGeneration(generation: unknown) {
  if (generation !== capturedGeneration()) throw new RestoreGuardError();
  assertGeneration(readInstanceState(getDatabasePath()), capturedGeneration());
}
export function withDataGeneration<T>(generation: string, operation: () => T): T { return scope.run(generation, operation); }
// Outer business functions capture before any read or external call. Nested
// operations inherit the same generation and cannot refresh an old payload.
export function businessOperation<A extends unknown[], R>(operation: (...args: A) => Promise<R>) {
  return (...args: A): Promise<R> => {
    const state = readInstanceState(getDatabasePath());
    const generation = scope.getStore() ?? state.dataGeneration;
    try { assertGeneration(state, generation); } catch (error) { return Promise.reject(error); }
    return scope.run(generation, async () => {
      const result = await operation(...args);
      assertGeneration(readInstanceState(getDatabasePath()), generation);
      return result;
    });
  };
}
// Check inside the SAME SQLite transaction as all dependent writes. The first
// read pins its snapshot; SQLite rejects a stale snapshot when upgrading to write.
export async function businessTransaction<R>(prisma: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<R>): Promise<R> {
  const generation = capturedGeneration();
  return prisma.$transaction(async (tx) => {
    const [state] = await tx.$queryRaw<{ id: string; dataGeneration: string; activeRestoreId: string | null }[]>`SELECT * FROM "InstanceState" WHERE id = 'singleton'`;
    if (!state) throw new Error("实例元数据缺失，写入已停止。");
    assertGeneration(state, generation);
    return operation(tx);
  });
}
