// Each AI stage can make an initial completion and one JSON repair. Give the
// route time to finish both, then keep the browser alive beyond that budget.
export const PLANNING_COMPLETION_TIMEOUT_MS = 120_000;
export const PLANNING_REQUEST_TIMEOUT_MS = 315_000;
