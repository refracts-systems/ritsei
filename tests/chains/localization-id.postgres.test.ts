import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { AuthorizationDenied } from "../../framework/modules/authorization/mod.ts"
import { runMigrations } from "../../framework/platform/mod.ts"
import {
  AccountingCapabilities,
  ChartTemplateNotFound,
  GeneralLedgerService,
} from "../../erp/modules/accounting/mod.ts"
import {
  LocalizationIdCapabilities,
  LocalizationIdService,
} from "../../erp/modules/localization_id/mod.ts"
import {
  ExternalIdentifierInvalid,
  PartyCapabilities,
  PartyService,
} from "../../erp/modules/party/mod.ts"
import { TaxCapabilities, TaxService } from "../../erp/modules/tax/mod.ts"
import { seedErpFixture } from "../support/erp-fixture.ts"
import { erpChainLayers } from "../support/erp-layers.ts"
import { withTemporaryDatabase } from "../support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]
const admin = { userAccountId: "id-admin", sessionId: "id-admin-session" }
const outsider = { userAccountId: "id-outsider", sessionId: "id-outsider-session" }

it.effect.skipIf(databaseUrl === undefined)(
  "sets a legal entity up for Indonesian trading and checks taxpayer identifiers",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId, legalEntityId, organizationId } = yield* seedErpFixture(client)

        const grants = [
          ...Object.values(AccountingCapabilities),
          ...Object.values(LocalizationIdCapabilities),
          ...Object.values(PartyCapabilities),
          ...Object.values(TaxCapabilities),
        ].map((capability) => ({ userAccountId: admin.userAccountId, tenantId, capability }))

        yield* Effect.gen(function* () {
          const localization = yield* LocalizationIdService
          const ledger = yield* GeneralLedgerService
          const tax = yield* TaxService
          const party = yield* PartyService
          const scope = { principal: admin, tenantId }

          const first = yield* localization.setup({ ...scope, legalEntityId })

          assert.strictEqual(first.chart.template, "indonesia_trading")
          assert.strictEqual(first.chart.accounts, 18)
          assert.deepStrictEqual(first.taxCodes, [
            { code: "PPN_KELUARAN_11", created: true },
            { code: "PPN_MASUKAN_11", created: true },
          ])

          // The chart and the posting rules exist, by Indonesian account code.
          const chart = yield* ledger.listChart(scope)
          const byId = new Map(chart.map((account) => [account.id, account.code]))

          assert.include(
            chart.map((account) => account.name),
            "Piutang usaha",
          )
          assert.deepStrictEqual(
            (yield* ledger.listPostingRules({ ...scope, legalEntityId }))
              .map((rule) => [rule.role, byId.get(rule.accountId)])
              .toSorted(([left], [right]) => String(left).localeCompare(String(right)))
              .slice(0, 3),
            [
              ["cash", "1-1100"],
              ["cost_of_goods_sold", "5-1100"],
              ["goods_received_not_invoiced", "2-1300"],
            ],
          )

          assert.deepStrictEqual(
            (yield* tax.listTaxCodes(scope)).map((code) => [code.code, code.rate, code.direction]),
            [
              ["PPN_KELUARAN_11", "11.0000", "sales"],
              ["PPN_MASUKAN_11", "11.0000", "purchase"],
            ],
          )

          // Running it again changes nothing that exists.
          const again = yield* localization.setup({ ...scope, legalEntityId })

          assert.strictEqual(again.chart.accounts, 18)
          assert.deepStrictEqual(
            again.taxCodes.map((code) => code.created),
            [false, false],
          )
          assert.strictEqual((yield* ledger.listChart(scope)).length, 18)

          assert.instanceOf(
            yield* Effect.flip(ledger.applyChartTemplate({ ...scope, template: "no_such_chart" })),
            ChartTemplateNotFound,
          )

          assert.instanceOf(
            yield* Effect.flip(
              localization.setup({ principal: outsider, tenantId, legalEntityId }),
            ),
            AuthorizationDenied,
          )

          // Taxpayer identifiers: NPWP and NIK are checked, other schemes are taken as given.
          const attach = (scheme: string, value: string) =>
            party.attachIdentifier({
              ...scope,
              partyId: organizationId,
              provider: "DJP",
              scheme,
              scope: "tenant",
              value,
            })

          assert.strictEqual((yield* attach("NPWP", "01.234.567.8-901.000")).scheme, "NPWP")

          const rejected = yield* Effect.flip(attach("NPWP", "123"))

          assert.instanceOf(rejected, ExternalIdentifierInvalid)
          assert.include(rejected.reason, "15 or 16 digits")
          assert.strictEqual((yield* attach("PASSPORT", "X1234567")).scheme, "PASSPORT")
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 120_000 },
)
