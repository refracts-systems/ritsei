import * as Predicate from "effect/Predicate"

/** Whether a rejected file-system call failed with the given errno code, such as `ENOENT`. */
export const hasErrnoCode = (cause: unknown, code: string) =>
  Predicate.hasProperty(cause, "code") && cause.code === code
