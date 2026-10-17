import { getDatabasePath } from "./data-directory";
import { assertGeneration, readInstanceState, RestoreGuardError } from "../scripts/restore-core.mjs";
import { withDataGeneration } from "./business-guard";
import { hasAppAccess, appWriteAccessError, unauthorizedResponse } from "./access";

export function businessRoute<A extends [Request, ...unknown[]]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const request = args[0], writing = !["GET", "HEAD"].includes(request.method);
    const access = writing ? appWriteAccessError(request) : !hasAppAccess(request) ? unauthorizedResponse() : null;
    if (access) return access;
    try {
      const state = readInstanceState(getDatabasePath());
      const generation = request.headers.get("x-data-generation") ?? (writing ? null : state.dataGeneration);
      assertGeneration(state, generation);
      const response = await withDataGeneration(generation!, () => handler(...args));
      // Existing handlers map their own errors; restore errors must retain the
      // common reload contract even when caught by an older handler.
      assertGeneration(readInstanceState(getDatabasePath()), generation);
      response.headers.set("x-data-generation", generation!);
      return response;
    } catch (error) {
      if (error instanceof RestoreGuardError) return Response.json({ error: error.message, code: error.code, reloadRequired: true }, { status: error.status });
      throw error;
    }
  };
}
