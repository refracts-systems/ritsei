import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { uuidv7 } from "../../../foundation/mod.ts"
import {
  AllocateNumberInput,
  type AllocatedNumber,
  DEFAULT_PADDING,
  fiscalPeriodKey,
  formatNumber,
  type NumberingService,
} from "./contract.ts"

/** Deterministic test numbering with the same per-series, per-document, gapless behavior. */
export const makeMemoryNumberingService = (): NumberingService => {
  const series = new Map<string, { id: string; prefix: string; padding: number; next: number }>()
  const issued = new Map<string, AllocatedNumber>()
  return {
    allocate: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(AllocateNumberInput)(input)
        const periodKey = fiscalPeriodKey(decoded.documentDate, decoded.fiscalYearStartMonth)
        const key = [decoded.tenantId, decoded.scopeId, decoded.documentType, periodKey].join(":")
        const current = series.get(key) ?? {
          id: uuidv7(),
          prefix: decoded.prefix,
          padding: decoded.padding ?? DEFAULT_PADDING,
          next: 1,
        }
        series.set(key, current)
        const documentKey = `${current.id}:${decoded.documentId}`
        const existing = issued.get(documentKey)
        if (existing !== undefined) return existing
        const value = current.next
        current.next += 1
        const allocated = {
          seriesId: current.id,
          periodKey,
          value,
          number: formatNumber(current.prefix, periodKey, value, current.padding),
        }
        issued.set(documentKey, allocated)
        return allocated
      }),
  }
}
