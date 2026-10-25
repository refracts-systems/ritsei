/** Taxpayer identifiers as the Indonesian tax authority and population registry issue them. */

/** Dots and dashes are how an NPWP is usually written; they carry no information. */
const digitsOf = (value: string) => value.replace(/[.\-\s]/g, "")

/** An NPWP is 15 digits (the format until 2023) or 16 digits (a NIK or the new 16-digit NPWP). */
export const npwpRejection = (value: string): string | undefined =>
  /^\d{15,16}$/.test(digitsOf(value))
    ? undefined
    : "An NPWP has 15 or 16 digits; dots and dashes are allowed"

/**
 * A NIK has 16 digits: a six-digit area code, the birth date as day, month and two-digit year
 * (women have 40 added to the day), and a four-digit sequence.
 */
export const nikRejection = (value: string): string | undefined => {
  const digits = digitsOf(value)

  if (!/^\d{16}$/.test(digits)) return "A NIK has 16 digits"

  const day = Number(digits.slice(6, 8))
  const month = Number(digits.slice(8, 10))

  const dayValid = (day >= 1 && day <= 31) || (day >= 41 && day <= 71)

  return dayValid && month >= 1 && month <= 12
    ? undefined
    : "The birth date inside a NIK is not a real date"
}

const rules = new Map([
  ["NPWP", npwpRejection],
  ["NIK", nikRejection],
])

/** The rejection reason for a value of a scheme this localization knows; undefined otherwise. */
export const identifierRejection = (input: {
  readonly scheme: string
  readonly value: string
}): string | undefined => rules.get(input.scheme)?.(input.value)
