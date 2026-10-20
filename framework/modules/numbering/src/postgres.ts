import { and, eq, sql } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { issuedNumbers, numberSeries } from "../../../../db/schema/numbering.ts"
import { Database } from "../../../foundation/mod.ts"
import {
  AllocateNumberInput,
  DEFAULT_PADDING,
  FiscalCalendar,
  fiscalPeriodKey,
  formatNumber,
  type NumberingService,
} from "./contract.ts"

export const makePostgresNumberingService = Effect.fn("Numbering.makePostgresService")(
  function* () {
    const database = yield* Database
    const calendar = yield* Effect.serviceOption(FiscalCalendar)

    const allocate = Effect.fn("NumberingService.allocate")(function* (input: unknown) {
      const decoded = yield* Schema.decodeUnknownEffect(AllocateNumberInput)(input)
      const startMonth =
        decoded.fiscalYearStartMonth ??
        (Option.isSome(calendar)
          ? yield* calendar.value.fiscalYearStartMonth(decoded.tenantId, decoded.scopeId)
          : 1)
      const periodKey = fiscalPeriodKey(decoded.documentDate, startMonth)
      return yield* database.transaction(async (tx) => {
        await tx
          .insert(numberSeries)
          .values({
            tenantId: decoded.tenantId,
            scopeId: decoded.scopeId,
            documentType: decoded.documentType,
            periodKey,
            prefix: decoded.prefix,
            padding: decoded.padding ?? DEFAULT_PADDING,
          })
          .onConflictDoNothing({
            target: [
              numberSeries.tenantId,
              numberSeries.scopeId,
              numberSeries.documentType,
              numberSeries.periodKey,
            ],
          })
        // Locking the series row serializes allocation until commit, which keeps the series gapless.
        const series = (
          await tx
            .select()
            .from(numberSeries)
            .where(
              and(
                eq(numberSeries.tenantId, decoded.tenantId),
                eq(numberSeries.scopeId, decoded.scopeId),
                eq(numberSeries.documentType, decoded.documentType),
                eq(numberSeries.periodKey, periodKey),
              ),
            )
            .for("update")
        )[0]!
        const existing = (
          await tx
            .select({ value: issuedNumbers.value, number: issuedNumbers.number })
            .from(issuedNumbers)
            .where(
              and(
                eq(issuedNumbers.seriesId, series.id),
                eq(issuedNumbers.documentId, decoded.documentId),
              ),
            )
        )[0]
        if (existing !== undefined) {
          return {
            seriesId: series.id,
            periodKey,
            value: Number(existing.value),
            number: existing.number,
          }
        }
        const value = Number(series.nextValue)
        const number = formatNumber(series.prefix, periodKey, value, series.padding)
        await tx
          .update(numberSeries)
          .set({ nextValue: sql`${numberSeries.nextValue} + 1`, updatedAt: new Date() })
          .where(eq(numberSeries.id, series.id))
        await tx.insert(issuedNumbers).values({
          tenantId: decoded.tenantId,
          seriesId: series.id,
          value: BigInt(value),
          number,
          documentId: decoded.documentId,
        })
        return { seriesId: series.id, periodKey, value, number }
      }, "numbering.allocate")
    })

    return { allocate } satisfies NumberingService
  },
)
