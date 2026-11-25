import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  SignedAmount,
  Uuid,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"

/** A calendar month, `YYYY-MM`. */
export const Period = Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/))

export const KpisInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  legalEntityId: Uuid,
  period: Period,
})

/**
 * `ok` carries the figures. `denied` means the caller may not read the owner that holds the figure,
 * and `unavailable` that the legal entity has no data to compute it from (for example no cash
 * posting rule); neither is shown as zero.
 */
export const KpiStatus = Schema.Literals(["ok", "denied", "unavailable"])

/** One amount for the period and the same amount for the previous period. */
export const Kpi = Schema.Struct({
  status: KpiStatus,
  value: Schema.NullOr(SignedAmount),
  previous: Schema.NullOr(SignedAmount),
})

/** Orders with something still to deliver, and what that is worth, now and a period earlier. */
export const UndeliveredKpi = Schema.Struct({
  status: KpiStatus,
  value: Schema.NullOr(SignedAmount),
  previous: Schema.NullOr(SignedAmount),
  orders: Schema.NullOr(Schema.Int),
  previousOrders: Schema.NullOr(Schema.Int),
})

/**
 * Six figures of one legal entity for a calendar month, each beside the previous month. Flow figures
 * (net sales) cover the month; balance figures are as of its last day.
 *
 * - `netSales`: customer invoices less credit notes dated in the month, before tax.
 * - `receivableOverdue` and `payableOverdue`: open items past their due date on the last day, by the
 *   payment terms of Settlement (credit notes and unallocated payments are not netted off).
 * - `cash`: the ledger balance of the cash posting role on the last day.
 * - `confirmedUndelivered`: confirmed orders with undelivered quantity at order prices; an order
 *   cancelled since the date is not counted, so the previous figure can understate.
 * - `inventoryValue`: the ledger balance of the inventory posting role on the last day.
 */
export const Kpis = Schema.Struct({
  legalEntityId: Uuid,
  period: Period,
  from: CalendarDate,
  to: CalendarDate,
  previousPeriod: Period,
  netSales: Kpi,
  receivableOverdue: Kpi,
  payableOverdue: Kpi,
  cash: Kpi,
  confirmedUndelivered: UndeliveredKpi,
  inventoryValue: Kpi,
})

export type Kpis = Schema.Schema.Type<typeof Kpis>

export type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

/** Read-only figures joined from the modules that own the data; it owns no data itself. */
export interface InsightsService {
  readonly kpis: (
    input: Schema.Codec.Encoded<typeof KpisInput>,
  ) => Effect.Effect<Kpis, CommonFailure>
}

export const InsightsService = Context.Service<InsightsService>("RITSEI/InsightsService")
