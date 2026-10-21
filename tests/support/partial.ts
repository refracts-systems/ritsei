/**
 * A test double that implements only the parts a test exercises, or a deliberately invalid input,
 * asserted into the full type: `partial<Service>()(double)`. This is the one place doubles are
 * cast, so a test never chains `as unknown as`.
 */
export const partial =
  <T>() =>
  <Value>(value: Value): T =>
    // SAFETY: a double implements only the members its test exercises, and an invalid input is
    // sent on purpose to prove the receiver rejects it.
    value as never
