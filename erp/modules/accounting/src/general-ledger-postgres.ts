import { and, asc, eq, gte, inArray, lte, sum } from "drizzle-orm"
import * as Effect from "effect/Effect"

import {
  accountingPeriods,
  accounts,
  journalEntries,
  journalLines,
  legalEntityAccountingConfigurations,
  postingRules,
} from "../../../../db/schema/accounting.ts"
import {
  Database,
  isDatabaseConstraint,
  requireExactMajorToMinor,
  uuidv7,
} from "../../../../framework/foundation/mod.ts"
import { NumberingService } from "../../../../framework/modules/numbering/mod.ts"
import type { LedgerAccount, LedgerEntry, PostingRole } from "./general-ledger-contract.ts"
import type {
  GeneralLedgerStore,
  PostEntryCommand,
  PostEntryOutcome,
} from "./general-ledger-store.ts"
import {
  AccountAlreadyExists,
  AccountingLegalEntityNotFound,
  AccountNotFound,
  InvalidParentAccount,
} from "./errors.ts"

const accountSelection = {
  id: accounts.id,
  tenantId: accounts.tenantId,
  code: accounts.code,
  name: accounts.name,
  type: accounts.type,
  parentAccountId: accounts.parentAccountId,
}

/** Normalizes a NUMERIC string to two decimals without floating point. */
const normalize = (value: string) => {
  const negative = value.startsWith("-")
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".")
  return `${negative ? "-" : ""}${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`
}

const lineKey = (line: { accountId: string; debit: string; credit: string }) =>
  `${line.accountId}:${requireExactMajorToMinor(line.debit, 2)}:${requireExactMajorToMinor(line.credit, 2)}`

type Posting = {
  readonly legalEntityId: string
  readonly postingDate: string
  readonly sourceType: string | null
  readonly sourceId: string | null
}

/** What a retried posting must repeat: legal entity, date, source, and lines. */
const postingKey = (posting: Posting, lines: ReadonlyArray<AccountLine>) =>
  JSON.stringify([
    posting.legalEntityId,
    posting.postingDate,
    posting.sourceType,
    posting.sourceId,
    lines.map(lineKey).toSorted(),
  ])

const NO_SOURCE = { type: null, id: null } as const

const commandPosting = (command: PostEntryCommand): Posting => {
  const source = command.source ?? NO_SOURCE
  return {
    legalEntityId: command.legalEntityId,
    postingDate: command.postingDate,
    sourceType: source.type,
    sourceId: source.id,
  }
}

const POSTED_STATUSES = ["posted", "reversed"] as const

type AccountLine = { accountId: string; debit: string; credit: string }

export const makeGeneralLedgerPostgresStore = Effect.fn("GeneralLedger.makePostgresStore")(
  function* () {
    const database = yield* Database
    const numbering = yield* NumberingService

    const createAccount: GeneralLedgerStore["createAccount"] = (command) =>
      database
        .query(
          (db) =>
            db
              .insert(accounts)
              .values({
                tenantId: command.tenantId,
                code: command.code,
                name: command.name,
                type: command.type,
                parentAccountId: command.parentAccountId,
              })
              .returning(accountSelection),
          "accounting.ledger.account.create",
        )
        .pipe(
          Effect.map((rows) => rows[0]!),
          Effect.mapError((error) => {
            if (isDatabaseConstraint(error, "accounts_tenant_code_key")) {
              return new AccountAlreadyExists({ tenantId: command.tenantId, code: command.code })
            }
            if (
              command.parentAccountId !== null &&
              isDatabaseConstraint(error, "accounts_parent_same_type_fkey", "23503")
            ) {
              return new InvalidParentAccount({
                tenantId: command.tenantId,
                parentAccountId: command.parentAccountId,
              })
            }
            return error
          }),
        )

    const listChart: GeneralLedgerStore["listChart"] = (tenantId) =>
      database.query(
        (db) =>
          db
            .select(accountSelection)
            .from(accounts)
            .where(eq(accounts.tenantId, tenantId))
            .orderBy(asc(accounts.code)),
        "accounting.ledger.chart.list",
      )

    const ensureTemplateAccounts: GeneralLedgerStore["ensureTemplateAccounts"] = (
      tenantId,
      template,
    ) =>
      database.transaction(async (tx) => {
        const byCode = new Map<string, LedgerAccount>()
        const existing = await tx
          .select(accountSelection)
          .from(accounts)
          .where(
            and(
              eq(accounts.tenantId, tenantId),
              inArray(
                accounts.code,
                template.map((account) => account.code),
              ),
            ),
          )
        for (const account of existing) byCode.set(account.code, account)
        // Template order lists parents before children.
        for (const account of template) {
          if (byCode.has(account.code)) continue
          const parent =
            account.parentCode === undefined ? undefined : byCode.get(account.parentCode)
          const created = (
            await tx
              .insert(accounts)
              .values({
                tenantId,
                code: account.code,
                name: account.name,
                type: account.type,
                parentAccountId: parent?.type === account.type ? parent.id : null,
              })
              .returning(accountSelection)
          )[0]!
          byCode.set(created.code, created)
        }
        return template.map((account) => byCode.get(account.code)!)
      }, "accounting.ledger.chart.template")

    const setPostingRule: GeneralLedgerStore["setPostingRule"] = (rule, options) =>
      database
        .query((db) => {
          const insert = db.insert(postingRules).values(rule)
          return (
            options.replace
              ? insert.onConflictDoUpdate({
                  target: [postingRules.tenantId, postingRules.legalEntityId, postingRules.role],
                  set: { accountId: rule.accountId, updatedAt: new Date() },
                })
              : insert.onConflictDoNothing()
          ).returning({
            tenantId: postingRules.tenantId,
            legalEntityId: postingRules.legalEntityId,
            role: postingRules.role,
            accountId: postingRules.accountId,
          })
        }, "accounting.ledger.posting_rule.set")
        .pipe(
          Effect.map((rows) => rows[0] ?? rule),
          Effect.mapError((error) => {
            if (isDatabaseConstraint(error, "posting_rules_account_fkey", "23503")) {
              return new AccountNotFound({ tenantId: rule.tenantId })
            }
            if (isDatabaseConstraint(error, "posting_rules_legal_entity_fkey", "23503")) {
              return new AccountingLegalEntityNotFound({
                tenantId: rule.tenantId,
                legalEntityId: rule.legalEntityId,
              })
            }
            return error
          }),
        )

    const listPostingRules: GeneralLedgerStore["listPostingRules"] = (tenantId, legalEntityId) =>
      database.query(
        (db) =>
          db
            .select({
              tenantId: postingRules.tenantId,
              legalEntityId: postingRules.legalEntityId,
              role: postingRules.role,
              accountId: postingRules.accountId,
            })
            .from(postingRules)
            .where(
              and(
                eq(postingRules.tenantId, tenantId),
                eq(postingRules.legalEntityId, legalEntityId),
              ),
            )
            .orderBy(asc(postingRules.role)),
        "accounting.ledger.posting_rule.list",
      )

    const loadEntry = (tenantId: string, reference: string) =>
      database.transaction(async (tx) => {
        const entry = (
          await tx
            .select()
            .from(journalEntries)
            .where(
              and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.reference, reference)),
            )
            .for("update")
        )[0]
        if (entry === undefined) return undefined
        const lines = await tx
          .select({
            accountId: journalLines.accountId,
            debit: journalLines.debit,
            credit: journalLines.credit,
          })
          .from(journalLines)
          .where(and(eq(journalLines.tenantId, tenantId), eq(journalLines.entryId, entry.id)))
          .orderBy(asc(journalLines.id))
        return {
          entry,
          lines: lines.map((line) => ({
            accountId: line.accountId,
            debit: normalize(line.debit ?? "0"),
            credit: normalize(line.credit ?? "0"),
          })),
        }
      }, "accounting.ledger.entry.load")

    const toEntry = (
      row: NonNullable<Effect.Success<ReturnType<typeof loadEntry>>>,
    ): LedgerEntry | undefined =>
      row.entry.legalEntityId === null ||
      row.entry.postingDate === null ||
      row.entry.number === null ||
      row.entry.postedAt === null
        ? undefined
        : {
            id: row.entry.id,
            tenantId: row.entry.tenantId,
            legalEntityId: row.entry.legalEntityId,
            number: row.entry.number,
            reference: row.entry.reference,
            postingDate: row.entry.postingDate,
            description: row.entry.description,
            sourceType: row.entry.sourceType,
            sourceId: row.entry.sourceId,
            postedAt: row.entry.postedAt.toISOString(),
            lines: row.lines,
          }

    /** Locks the configuration and open period, and loads posting rules. */
    const preparePosting = (command: PostEntryCommand) =>
      database.transaction(async (tx) => {
        const configuration = (
          await tx
            .select({
              postingEnabled: legalEntityAccountingConfigurations.postingEnabled,
              financialEngine: legalEntityAccountingConfigurations.financialEngine,
              fiscalYearStartMonth: legalEntityAccountingConfigurations.fiscalYearStartMonth,
            })
            .from(legalEntityAccountingConfigurations)
            .where(
              and(
                eq(legalEntityAccountingConfigurations.tenantId, command.tenantId),
                eq(legalEntityAccountingConfigurations.legalEntityId, command.legalEntityId),
              ),
            )
            .for("share")
        )[0]
        if (configuration === undefined) return { _tag: "not-configured" as const }
        if (configuration.financialEngine !== "postgresql") {
          return { _tag: "engine-activated" as const }
        }
        // A shared lock on the open period makes a concurrent close wait for this posting.
        const period = (
          await tx
            .select({ id: accountingPeriods.id })
            .from(accountingPeriods)
            .where(
              and(
                eq(accountingPeriods.tenantId, command.tenantId),
                eq(accountingPeriods.legalEntityId, command.legalEntityId),
                eq(accountingPeriods.status, "open"),
                lte(accountingPeriods.startsOn, command.postingDate),
                gte(accountingPeriods.endsOn, command.postingDate),
              ),
            )
            .for("share")
        )[0]
        if (period === undefined || !configuration.postingEnabled) {
          return { _tag: "period-not-open" as const }
        }
        const rules = await tx
          .select({ role: postingRules.role, accountId: postingRules.accountId })
          .from(postingRules)
          .where(
            and(
              eq(postingRules.tenantId, command.tenantId),
              eq(postingRules.legalEntityId, command.legalEntityId),
            ),
          )
        return {
          _tag: "ready" as const,
          fiscalYearStartMonth: configuration.fiscalYearStartMonth,
          rules: new Map<PostingRole, string>(rules.map((rule) => [rule.role, rule.accountId])),
        }
      }, "accounting.ledger.entry.prepare")

    /** Resolves role lines to accounts, or names the first role without a posting rule. */
    const resolveLines = (
      lines: PostEntryCommand["lines"],
      rules: ReadonlyMap<PostingRole, string>,
    ): { readonly lines: AccountLine[] } | { readonly missing: PostingRole } => {
      const resolved: AccountLine[] = []
      for (const line of lines) {
        if ("accountId" in line) {
          resolved.push({ accountId: line.accountId, debit: line.debit, credit: line.credit })
          continue
        }
        const accountId = rules.get(line.role)
        if (accountId === undefined) return { missing: line.role }
        resolved.push({ accountId, debit: line.debit, credit: line.credit })
      }
      return { lines: resolved }
    }

    /** A retried posting must repeat the entry it posted before. */
    const replay = (
      existing: NonNullable<Effect.Success<ReturnType<typeof loadEntry>>>,
      command: PostEntryCommand,
      lines: ReadonlyArray<AccountLine>,
    ): PostEntryOutcome => {
      const entry = toEntry(existing)
      return entry !== undefined &&
        postingKey(entry, entry.lines) === postingKey(commandPosting(command), lines)
        ? { _tag: "posted", entry }
        : { _tag: "idempotency-conflict" }
    }

    /** Inserts the draft entry and its lines, then posts it, which runs the balance check. */
    const insertEntry = (
      command: PostEntryCommand,
      entryId: string,
      number: string,
      lines: ReadonlyArray<AccountLine>,
    ) =>
      database
        .transaction(async (tx) => {
          await tx.insert(journalEntries).values({
            id: entryId,
            tenantId: command.tenantId,
            reference: command.reference,
            legalEntityId: command.legalEntityId,
            postingDate: command.postingDate,
            number,
            description: command.description,
            sourceType: command.source?.type ?? null,
            sourceId: command.source?.id ?? null,
          })
          await tx.insert(journalLines).values(
            lines.map((line) => ({
              tenantId: command.tenantId,
              entryId,
              accountId: line.accountId,
              debit: line.debit,
              credit: line.credit,
            })),
          )
          const postedAt = new Date()
          await tx
            .update(journalEntries)
            .set({ status: "posted", postedAt, updatedAt: postedAt })
            .where(eq(journalEntries.id, entryId))
          return {
            _tag: "posted",
            entry: {
              id: entryId,
              tenantId: command.tenantId,
              legalEntityId: command.legalEntityId,
              number,
              reference: command.reference,
              postingDate: command.postingDate,
              description: command.description,
              sourceType: command.source?.type ?? null,
              sourceId: command.source?.id ?? null,
              postedAt: postedAt.toISOString(),
              lines: lines.map((line) => ({
                accountId: line.accountId,
                debit: normalize(line.debit),
                credit: normalize(line.credit),
              })),
            },
          } satisfies PostEntryOutcome
        }, "accounting.ledger.entry.post")
        .pipe(
          Effect.catchIf(
            (error) => isDatabaseConstraint(error, "journal_lines_account_fkey", "23503"),
            () => Effect.succeed<PostEntryOutcome>({ _tag: "account-missing" }),
          ),
        )

    const postEntry: GeneralLedgerStore["postEntry"] = (command) =>
      database.withTransaction(
        Effect.gen(function* () {
          const context = yield* preparePosting(command)
          if (context._tag !== "ready") return context satisfies PostEntryOutcome
          const resolved = resolveLines(command.lines, context.rules)
          if ("missing" in resolved) return { _tag: "rule-missing", role: resolved.missing }
          const existing = yield* loadEntry(command.tenantId, command.reference)
          if (existing !== undefined) return replay(existing, command, resolved.lines)
          const entryId = uuidv7()
          const allocated = yield* numbering
            .allocate({
              tenantId: command.tenantId,
              scopeId: command.legalEntityId,
              documentType: "accounting.journal",
              documentId: entryId,
              documentDate: command.postingDate,
              fiscalYearStartMonth: context.fiscalYearStartMonth,
              prefix: "JE/",
            })
            .pipe(Effect.catchTag("SchemaError", (error) => Effect.die(error)))
          return yield* insertEntry(command, entryId, allocated.number, resolved.lines)
        }),
        "accounting.ledger.entry.atomic",
      )

    const accountActivity: GeneralLedgerStore["accountActivity"] = (query) =>
      database
        .query(
          (db) =>
            db
              .select({
                accountId: journalLines.accountId,
                debit: sum(journalLines.debit),
                credit: sum(journalLines.credit),
              })
              .from(journalLines)
              .innerJoin(
                journalEntries,
                and(
                  eq(journalEntries.tenantId, journalLines.tenantId),
                  eq(journalEntries.id, journalLines.entryId),
                ),
              )
              .where(
                and(
                  eq(journalLines.tenantId, query.tenantId),
                  eq(journalEntries.legalEntityId, query.legalEntityId),
                  inArray(journalEntries.status, [...POSTED_STATUSES]),
                  lte(journalEntries.postingDate, query.to),
                  query.from === null ? undefined : gte(journalEntries.postingDate, query.from),
                  query.accountId === undefined
                    ? undefined
                    : eq(journalLines.accountId, query.accountId),
                ),
              )
              .groupBy(journalLines.accountId),
          "accounting.ledger.activity",
        )
        .pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              accountId: row.accountId,
              debit: normalize(row.debit ?? "0"),
              credit: normalize(row.credit ?? "0"),
            })),
          ),
        )

    const ledgerLines: GeneralLedgerStore["ledgerLines"] = (query) =>
      database
        .query(
          (db) =>
            db
              .select({
                entryId: journalEntries.id,
                number: journalEntries.number,
                postingDate: journalEntries.postingDate,
                reference: journalEntries.reference,
                description: journalEntries.description,
                debit: journalLines.debit,
                credit: journalLines.credit,
              })
              .from(journalLines)
              .innerJoin(
                journalEntries,
                and(
                  eq(journalEntries.tenantId, journalLines.tenantId),
                  eq(journalEntries.id, journalLines.entryId),
                ),
              )
              .where(
                and(
                  eq(journalLines.tenantId, query.tenantId),
                  eq(journalLines.accountId, query.accountId),
                  eq(journalEntries.legalEntityId, query.legalEntityId),
                  inArray(journalEntries.status, [...POSTED_STATUSES]),
                  gte(journalEntries.postingDate, query.from),
                  lte(journalEntries.postingDate, query.to),
                ),
              )
              .orderBy(
                asc(journalEntries.postingDate),
                asc(journalEntries.number),
                asc(journalLines.id),
              ),
          "accounting.ledger.lines",
        )
        .pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              entryId: row.entryId,
              number: row.number ?? "",
              postingDate: row.postingDate ?? query.from,
              reference: row.reference,
              description: row.description,
              debit: normalize(row.debit ?? "0"),
              credit: normalize(row.credit ?? "0"),
            })),
          ),
        )

    return {
      createAccount,
      listChart,
      ensureTemplateAccounts,
      setPostingRule,
      listPostingRules,
      postEntry,
      accountActivity,
      ledgerLines,
    } satisfies GeneralLedgerStore
  },
)
