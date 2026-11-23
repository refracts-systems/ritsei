/**
 * The pure decision of the key claim protocol (ADR-0124 phase 3), shared by the three modules that
 * model a claim: the sales and purchase order confirmation keys and the stock correction key. A
 * claim is stale when it is held by a holder that does not carry the value; a sweep reads the
 * holder (another aggregate), asks this, and releases only on `true`.
 *
 * The claim aggregate itself is not built here. A generic factory needs the command and event maps
 * typed by computed names, which erodes the typing of `decide` and `evolve`, so each module keeps
 * its own fully typed copy (see `erp/modules/sales/src/confirmation-claim-model.ts`).
 */
export const staleClaim = (heldBy: string, carriedBy: string | undefined) => carriedBy !== heldBy
