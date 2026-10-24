import * as Predicate from "effect/Predicate"

/**
 * A copy of `value` with every object's keys sorted, so equal facts serialize identically for
 * comparison and hashing. The result has the same type: only key order changes.
 */
export const canonicalize = <A>(value: A): A => {
  if (Array.isArray(value)) {
    // SAFETY: mapping every element keeps an array of the same element type.
    return value.map(canonicalize) as A
  }

  if (!Predicate.isObjectOrArray(value)) return value

  // SAFETY: the entries keep their keys and values and only change order.
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  ) as A
}
