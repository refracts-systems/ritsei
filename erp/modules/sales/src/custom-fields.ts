import { and, eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"

import { customers } from "../../../../db/schema/sales.ts"
import { Database } from "../../../../framework/foundation/mod.ts"
import {
  type OwnerCustomFields,
  ownerCustomFieldsLayer,
} from "../../../../framework/modules/custom-fields/mod.ts"
import { SalesCapabilities } from "./capabilities.ts"
import { CustomerNotFound } from "./errors.ts"

/** Custom fields on a customer, released through the sales manifest (ADR-0109). */
export type SalesCustomerFields = OwnerCustomFields<CustomerNotFound>

export const SalesCustomerFields = Context.Service<SalesCustomerFields>(
  "RITSEI/SalesCustomerFields",
)

export const SalesCustomerFieldsLive = ownerCustomFieldsLayer(
  SalesCustomerFields,
  Effect.gen(function* () {
    const database = yield* Database

    return {
      documentType: "sales.customer",
      configure: SalesCapabilities.customFieldConfigure,
      read: SalesCapabilities.customerRead,
      write: SalesCapabilities.customerCreate,
      exists: (tenantId: string, customerId: string) =>
        database
          .query(
            (db) =>
              db
                .select({ id: customers.id })
                .from(customers)
                .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)))
                .limit(1),
            "sales.customer.exists",
          )
          .pipe(
            Effect.flatMap((rows) =>
              rows.length === 0
                ? Effect.fail(new CustomerNotFound({ tenantId, customerId }))
                : Effect.void,
            ),
          ),
    }
  }),
)
