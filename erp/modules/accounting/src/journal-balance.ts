/**
 * Whether a journal balances (ACC-JNL-1): at least two lines, and total debits equal total credits
 * in minor units, with no tolerance. Every validator of a journal asks here, so no path can allow
 * a rounding difference another path refuses. Each caller keeps its own line checks and failure.
 */
export const journalBalances = (lineCount: number, debit: bigint, credit: bigint) =>
  lineCount >= 2 && debit === credit
