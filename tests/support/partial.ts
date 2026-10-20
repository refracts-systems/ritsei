/**
 * A test double that implements only the parts a test exercises, asserted into the full type. This
 * is the one place doubles are cast, so a test never chains `as unknown as`.
 */
export const partial = <T>(value: unknown): T => value as T
