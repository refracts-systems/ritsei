import type * as Effect from "effect/Effect"

import type { DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import type { CreateTaxCodeCommand, ProductTaxDefault, TaxCode, TaxDirection } from "./contract.ts"
import type { TaxCodeAlreadyExists, TaxCodeNotFound, TaxProductNotFound } from "./errors.ts"

export interface TaxStore {
  readonly listTaxCodes: (
    tenantId: string,
    direction: TaxDirection | undefined,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<TaxCode>, DatabaseFailure>
  readonly getTaxCodes: (
    tenantId: string,
    ids: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<TaxCode>, DatabaseFailure>
  readonly createTaxCode: (
    command: CreateTaxCodeCommand,
  ) => Effect.Effect<TaxCode, TaxCodeAlreadyExists | DatabaseFailure>
  readonly setProductTaxDefault: (
    value: ProductTaxDefault,
  ) => Effect.Effect<ProductTaxDefault, TaxCodeNotFound | TaxProductNotFound | DatabaseFailure>
  readonly productTaxDefaults: (
    tenantId: string,
    direction: TaxDirection,
    productIds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<ProductTaxDefault>, DatabaseFailure>
}
