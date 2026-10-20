import * as Predicate from "effect/Predicate"
export function prefersReducedMotion(): boolean {
  if (!Predicate.isFunction(globalThis.matchMedia)) return false

  return globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
}
