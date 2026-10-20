import { and, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { legalEntityAccountingConfigurations } from "../../../../db/schema/accounting.ts"
import { Database } from "../../../../framework/foundation/mod.ts"
import { FiscalCalendar } from "../../../../framework/modules/numbering/mod.ts"

/** Calendar year, used until a legal entity has an accounting configuration. */
const DEFAULT_START_MONTH = 1

/**
 * The fiscal calendar of a legal entity: the fiscal-year start month of its accounting
 * configuration, so every document owner numbers a legal entity's documents by the same fiscal year.
 */
export const AccountingFiscalCalendarLive = Layer.effect(
  FiscalCalendar,
  Effect.gen(function* () {
    const database = yield* Database
    return {
      fiscalYearStartMonth: (tenantId, scopeId) =>
        database
          .query(
            (db) =>
              db
                .select({ month: legalEntityAccountingConfigurations.fiscalYearStartMonth })
                .from(legalEntityAccountingConfigurations)
                .where(
                  and(
                    eq(legalEntityAccountingConfigurations.tenantId, tenantId),
                    eq(legalEntityAccountingConfigurations.legalEntityId, scopeId),
                  ),
                ),
            "accounting.fiscal_calendar.get",
          )
          .pipe(Effect.map((rows) => rows[0]?.month ?? DEFAULT_START_MONTH)),
    }
  }),
)
