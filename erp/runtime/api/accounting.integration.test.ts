import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { Etag, HttpPlatform } from "effect/http"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import * as HttpApiTest from "effect/http-api/HttpApiTest"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import {
  AccountingService,
  type AccountingService as AccountingServiceContract,
  FinancialOperationService,
  type FinancialOperationService as FinancialOperationServiceContract,
  GeneralLedgerService,
  type GeneralLedgerServiceShape,
} from "../../modules/accounting/mod.ts"
import { BearerAuth, CurrentPrincipal, RitseiApi } from "./api.ts"
import { AccountingHttpHandlers as AccountingHandlers } from "../../modules/accounting/http.ts"
import { unusedService } from "../../../tests/support/unused-service.ts"
import { partial } from "../../../tests/support/partial.ts"

const tenantId = "01920000-0000-7000-8000-000000000001"
const legalEntityId = "01920000-0000-7000-8000-000000000002"
const accountId = "01920000-0000-7000-8000-000000000003"
const journalId = "01920000-0000-7000-8000-000000000004"
const principal = { userAccountId: "accounting-api-user", sessionId: "accounting-api-session" }

const configuration = {
  tenantId,
  legalEntityId,
  baseCurrency: "USD",
  precision: 2 as const,
  fiscalYearStartMonth: 1,
  postingEnabled: true,
  financialEngine: "postgresql" as const,
}
const account = {
  id: accountId,
  tenantId,
  code: "1000",
  name: "Cash",
  type: "asset" as const,
}
const period = {
  id: "01920000-0000-7000-8000-000000000005",
  tenantId,
  legalEntityId,
  startsOn: "2026-01-01",
  endsOn: "2026-12-31",
  status: "open" as const,
}
const profile = {
  tenantId,
  legalEntityId,
  receivableAccountId: accountId,
  revenueAccountId: "01920000-0000-7000-8000-000000000006",
}
const closedPeriod = { ...period, status: "closed" as const }
const journal = {
  id: journalId,
  tenantId,
  reference: "opening-entry",
  status: "posted" as const,
  postedAt: "2026-09-13T00:00:00.000Z",
  lines: [
    { accountId, debit: "125.00", credit: "0.00" },
    { accountId: profile.revenueAccountId, debit: "0.00", credit: "125.00" },
  ],
}

const observedInputs: unknown[] = []
const accountingService = partial<AccountingServiceContract>({
  listAccountingConfigurations: (input: unknown) =>
    Effect.sync(() => {
      observedInputs.push(input)
      return [configuration]
    }),
  listAccounts: () => Effect.succeed([account]),
  listAccountingPeriods: () => Effect.succeed([period]),
  listRevenuePostingProfiles: () => Effect.succeed([profile]),
  listJournalEntries: () => Effect.succeed([journal]),
  configureLegalEntity: () => Effect.succeed(configuration),
  createAccount: () => Effect.succeed(account),
  configureRevenuePosting: () => Effect.succeed(profile),
  openPeriod: () => Effect.succeed(period),
  closePeriod: () => Effect.succeed(closedPeriod),
  postJournal: () => Effect.succeed(journal),
})

const financialOperations = {} as FinancialOperationServiceContract
// The ledger endpoints are covered by the general-ledger tests; these contracts never reach them.
const ledger = unusedService<GeneralLedgerServiceShape>("ledger")
const TestHttpServices = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

it.layer(TestHttpServices)("Accounting API contracts", (it) => {
  it.effect("forwards tenant and bearer context across Accounting reads and commands", () =>
    Effect.gen(function* () {
      const bearer = Layer.succeed(BearerAuth, {
        bearer: (effect) => Effect.provideService(effect, CurrentPrincipal, principal),
      })
      const bearerClient = HttpApiMiddleware.layerClient(BearerAuth, ({ request, next }) =>
        next(HttpClientRequest.bearerToken(request, "accounting-token")),
      )
      const handlers = AccountingHandlers.pipe(
        Layer.provide(bearer),
        Layer.provide(Layer.succeed(AccountingService, accountingService)),
        Layer.provide(Layer.succeed(FinancialOperationService, financialOperations)),
        Layer.provide(Layer.succeed(GeneralLedgerService, ledger)),
      )
      const client = yield* HttpApiTest.groups(RitseiApi, ["Accounting"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, bearerClient, bearer)),
      )
      const headers = { "x-tenant-id": tenantId }

      assert.deepStrictEqual(
        yield* client.Accounting.listConfigurations({
          headers,
          query: { legalEntityId, limit: 10 },
        }),
        [configuration],
      )
      assert.deepStrictEqual(
        yield* client.Accounting.listAccounts({ headers, query: { limit: 10 } }),
        [account],
      )
      assert.deepStrictEqual(
        yield* client.Accounting.listPeriods({ headers, query: { status: "open", limit: 10 } }),
        [period],
      )
      assert.deepStrictEqual(
        yield* client.Accounting.listRevenuePostingProfiles({
          headers,
          query: { legalEntityId, limit: 10 },
        }),
        [profile],
      )
      assert.deepStrictEqual(
        yield* client.Accounting.listJournals({ headers, query: { status: "posted", limit: 10 } }),
        [journal],
      )
      assert.deepStrictEqual(
        yield* client.Accounting.configureLegalEntity({
          params: { id: legalEntityId },
          headers,
          payload: {
            baseCurrency: "USD",
            precision: 2,
            fiscalYearStartMonth: 1,
            postingEnabled: true,
          },
        }),
        configuration,
      )
      assert.deepStrictEqual(
        yield* client.Accounting.createAccount({
          headers,
          payload: { code: "1000", name: "Cash", type: "asset" },
        }),
        account,
      )
      assert.deepStrictEqual(
        yield* client.Accounting.configureRevenuePosting({
          headers,
          payload: {
            legalEntityId,
            receivableAccountId: profile.receivableAccountId,
            revenueAccountId: profile.revenueAccountId,
          },
        }),
        profile,
      )
      assert.deepStrictEqual(
        yield* client.Accounting.openPeriod({
          headers,
          payload: { legalEntityId, startsOn: period.startsOn, endsOn: period.endsOn },
        }),
        period,
      )
      assert.deepStrictEqual(
        yield* client.Accounting.closePeriod({
          params: { id: period.id },
          headers,
          payload: { legalEntityId },
        }),
        closedPeriod,
      )
      assert.deepStrictEqual(
        yield* client.Accounting.postJournal({
          headers,
          payload: { reference: journal.reference, lines: journal.lines },
        }),
        journal,
      )
      const captured = observedInputs.at(-1) as { tenantId: string; principal: typeof principal }
      assert.strictEqual(captured.tenantId, tenantId)
      assert.deepStrictEqual(captured.principal, principal)
    }),
  )
})
