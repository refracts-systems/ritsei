import { and, eq, inArray, sql } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { invoices } from "../../../../db/schema/billing.ts"
import { Database } from "../../../../framework/foundation/mod.ts"
import { CreditExposure } from "../../sales/mod.ts"

/**
 * What a customer owes in a legal entity: the open amount of their invoices less the open amount of
 * their credit notes. It answers Sales' credit check without Sales reading Billing (ADR-0108), and
 * it needs no caller permission because it is part of the order confirmation policy.
 */
export const BillingCreditExposureLive = Layer.effect(
  CreditExposure,
  Effect.gen(function* () {
    const database = yield* Database

    return {
      receivableBalance: (input) =>
        database
          .query(
            (db) =>
              db
                .select({
                  balance: sql<string>`coalesce(sum(case when ${invoices.kind} = 'customer_invoice'
                    then ${invoices.openAmount} else -${invoices.openAmount} end), 0)::numeric(24,2)::text`,
                })
                .from(invoices)
                .where(
                  and(
                    eq(invoices.tenantId, input.tenantId),
                    eq(invoices.legalEntityId, input.legalEntityId),
                    eq(invoices.partyId, input.partyId),
                    inArray(invoices.kind, ["customer_invoice", "customer_credit_note"]),
                  ),
                ),
            "billing.credit_exposure",
          )
          .pipe(Effect.map((rows) => rows[0]?.balance ?? "0.00")),
      invoicedNet: (input) =>
        input.orderIds.length === 0
          ? Effect.succeed("0.00")
          : database
              .query(
                (db) =>
                  db
                    .select({
                      net: sql<string>`coalesce(sum(${invoices.subtotal}), 0)::numeric(24,2)::text`,
                    })
                    .from(invoices)
                    .where(
                      and(
                        eq(invoices.tenantId, input.tenantId),
                        eq(invoices.kind, "customer_invoice"),
                        eq(invoices.sourceType, "sales.order"),
                        inArray(invoices.sourceId, [...input.orderIds]),
                      ),
                    ),
                "billing.credit_exposure.invoiced",
              )
              .pipe(Effect.map((rows) => rows[0]?.net ?? "0.00")),
    }
  }),
)
