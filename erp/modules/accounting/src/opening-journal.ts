import { OPENING_BALANCE_SOURCE, type PostingRole } from "./general-ledger-contract.ts"

/**
 * The reference of a legal entity's opening journal (ACC-OPEN-1). One journal per legal entity, so
 * the legal entity is the idempotency key; the posting service and the Alchemy model both build it
 * here.
 */
export const openingJournalReference = (legalEntityId: string) =>
  `${OPENING_BALANCE_SOURCE}/${legalEntityId}`

/**
 * The instance key of the opening journal: the tenant and the reference. An Alchemy instance key
 * only; table rows keep their UUIDv7 ids, and PostgreSQL scopes the reference by tenant.
 */
export const openingJournalKey = (tenantId: string, legalEntityId: string) =>
  `${tenantId}/${openingJournalReference(legalEntityId)}`

/** Their owners load AR, AP, and stock against migration clearing, so the opening journal cannot (ADR-0117). */
export const OPENING_CONTROL_ROLES: ReadonlyArray<PostingRole> = [
  "receivable",
  "payable",
  "inventory",
]

/**
 * The first control role (ACC-OPEN-2) whose account a new entry's lines touch, with that account,
 * or undefined. Lines are resolved to accounts, so a line naming the account directly counts the
 * same as one naming the role.
 */
export const firstControlAccountLine = (
  controlRoles: ReadonlyArray<PostingRole>,
  lines: ReadonlyArray<{ readonly accountId: string }>,
  rules: ReadonlyMap<PostingRole, string>,
) => {
  for (const role of controlRoles) {
    const accountId = rules.get(role)

    if (accountId !== undefined && lines.some((line) => line.accountId === accountId)) {
      return { role, accountId }
    }
  }

  return undefined
}
