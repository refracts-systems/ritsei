import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { ChartTemplateRegistry, GeneralLedgerService } from "../../accounting/mod.ts"
import { IdentifierSchemes } from "../../party/mod.ts"
import { TaxService } from "../../tax/mod.ts"
import { LocalizationIdCapabilities } from "./capabilities.ts"
import { indonesiaTrading, indonesiaTradingTemplateId } from "./chart.ts"
import { LocalizationIdService, SetupInput } from "./contract.ts"
import { identifierRejection } from "./identifiers.ts"

/**
 * The PPN codes of 2026: 11 percent on sales and on purchases. The effective rate is the statutory
 * 12 percent applied to a tax base of 11/12 of the price; the tax module takes the resulting 11.
 */
const ppnCodes = [
  { code: "PPN_KELUARAN_11", name: "PPN keluaran 11%", rate: "11", direction: "sales" },
  { code: "PPN_MASUKAN_11", name: "PPN masukan 11%", rate: "11", direction: "purchase" },
] as const

export const makeLocalizationIdService = Effect.gen(function* () {
  const authorization = yield* AuthorizationService
  const ledger = yield* GeneralLedgerService
  const tax = yield* TaxService
  const authorized = scopedCommand(authorization)

  const setup = Effect.fn("LocalizationIdService.setup")(function* (
    input: Schema.Codec.Encoded<typeof SetupInput>,
  ) {
    const decoded = yield* authorized(SetupInput, LocalizationIdCapabilities.setupApply)(input)
    const scope = { principal: decoded.principal, tenantId: decoded.tenantId }

    const accounts = yield* ledger.applyChartTemplate({
      ...scope,
      template: indonesiaTradingTemplateId,
      legalEntityId: decoded.legalEntityId,
    })

    const taxCodes = yield* Effect.forEach(ppnCodes, (ppn) =>
      tax.createTaxCode({ ...scope, ...ppn }).pipe(
        Effect.as({ code: ppn.code, created: true }),
        Effect.catchTag("TaxCodeAlreadyExists", () =>
          Effect.succeed({ code: ppn.code, created: false }),
        ),
      ),
    )

    return {
      chart: { template: indonesiaTradingTemplateId, accounts: accounts.length },
      taxCodes,
    }
  })

  return { setup } satisfies LocalizationIdService
})

export const LocalizationIdLive = Layer.effect(LocalizationIdService, makeLocalizationIdService)

/** The Indonesian chart, offered to Accounting through its template registry. */
export const IndonesianChartTemplatesLive = Layer.succeed(ChartTemplateRegistry, {
  templates: { [indonesiaTradingTemplateId]: indonesiaTrading },
})

/** NPWP and NIK value rules, offered to Party's identifier schemes. */
export const IndonesianIdentifierSchemesLive = Layer.succeed(IdentifierSchemes, {
  rejection: identifierRejection,
})
