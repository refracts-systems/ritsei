/** The first day, last day, and previous month of a `YYYY-MM` period. */
export const periodDates = (period: string) => {
  const year = Number(period.slice(0, 4))
  const month = Number(period.slice(5, 7))
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const previous = new Date(Date.UTC(year, month - 2, 1))
  const previousLast = new Date(Date.UTC(year, month - 1, 0)).getUTCDate()
  const previousPeriod = previous.toISOString().slice(0, 7)

  return {
    from: `${period}-01`,
    to: `${period}-${String(last).padStart(2, "0")}`,
    previousPeriod,
    previousFrom: `${previousPeriod}-01`,
    previousTo: `${previousPeriod}-${String(previousLast).padStart(2, "0")}`,
  }
}
