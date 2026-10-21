import * as Predicate from "effect/Predicate"

/** The SQLSTATE of a failed driver call, or undefined when the failure carries none. */
export const postgresCode = <Failure>(failure: Failure) =>
  Predicate.hasProperty(failure, "code") ? failure.code : undefined

/** The violated constraint of a failed driver call, or undefined when it names none. */
export const postgresConstraint = <Failure>(failure: Failure) =>
  Predicate.hasProperty(failure, "constraint_name") ? failure.constraint_name : undefined
