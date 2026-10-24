// Presentation-only formatting for exact decimal strings returned by the API.
// Values are never converted to floating point, so financial precision is preserved.

const decimalPattern = /^(-?)(\d+)(?:\.(\d+))?$/

const separators = (locale?: string) => {
  const parts = new Intl.NumberFormat(locale).formatToParts(1000.5)

  return {
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
  }
}

/**
 * Groups the integer part of an exact decimal string for display, e.g. `24750000.00` →
 * `24,750,000.00`. Returns the input unchanged when it is not a plain decimal string.
 */
export const formatDecimal = (value: string, locale?: string): string => {
  const match = decimalPattern.exec(value.trim())

  if (match === null) return value
  const [, sign, integer, fraction] = match
  const grouped = new Intl.NumberFormat(locale, { useGrouping: true }).format(BigInt(integer!))

  return `${sign}${grouped}${fraction === undefined ? "" : `${separators(locale).decimal}${fraction}`}`
}
