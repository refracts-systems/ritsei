/**
 * A test double that implements only the parts a test exercises, asserted into the full type. This
 * is the one place doubles are cast, so a test never chains `as unknown as`.
 */
// SAFETY: a double implements only the members its test exercises.
export const partial = <T>(value: unknown): T => value as T
