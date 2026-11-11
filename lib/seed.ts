import type { WardenOperation } from "./types.ts";

export function seedOperations(operations: readonly WardenOperation[], seed: number): WardenOperation[] {
  let state = seed >>> 0;
  let clockMs = 0;
  return operations.map((operation) => {
    if (!("nowMs" in operation)) return { ...operation };
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    clockMs = Math.max(clockMs, operation.nowMs) + 10 + state % 41;
    return { ...operation, nowMs: clockMs };
  });
}
