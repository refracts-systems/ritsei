import * as Schema from "effect/Schema"

export type CatalogSchema = Schema.Codec<unknown, unknown, never, never>

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0))

export const CatalogStabilitySchema = Schema.Literals([
  "PRIVATE",
  "EXPERIMENTAL",
  "PUBLIC",
  "DEPRECATED",
  "RETIRED",
])

export type CatalogStability = Schema.Schema.Type<typeof CatalogStabilitySchema>

export const ActionIdempotencySchema = Schema.Literals(["required", "inherent", "unsupported"])

export type ActionIdempotency = Schema.Schema.Type<typeof ActionIdempotencySchema>

export type ActionTransactionSemantics =
  | "local_atomic"
  | "coordination_only"
  | "durable_external_effect"

export const ActionCompensationSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("action"),
    actionId: NonEmptyString,
    version: PositiveInteger,
  }),
  Schema.Struct({
    kind: Schema.Literal("none"),
    recovery: Schema.Literal("manual"),
  }),
])

export type ActionCompensation = Schema.Schema.Type<typeof ActionCompensationSchema>

export const CompatibilityRangeSchema = Schema.Struct({
  minimumVersion: PositiveInteger,
  maximumVersion: PositiveInteger,
}).check(
  Schema.makeFilter((range) =>
    range.minimumVersion <= range.maximumVersion
      ? undefined
      : {
          path: ["maximumVersion"],
          issue: "maximumVersion must be greater than or equal to minimumVersion",
        },
  ),
)

export type CompatibilityRange = Schema.Schema.Type<typeof CompatibilityRangeSchema>

export type ActionPrecondition =
  | "authorized"
  | "idempotency_key_stable"
  | "stock_reference_exists"
  | "stock_unit_matches"
  | "stock_remains_available"
  | "revenue_profile_configured"
  | "accounting_period_open"
  | "sales_order_draft"
  | "sales_order_confirmed"
  | "purchase_order_draft"
  | "accounts_exist"

export type ActionEffect =
  | "stock_balance_adjusted"
  | "stock_correction_recorded"
  | "revenue_journal_posted"
  | "sales_order_confirmed"
  | "purchase_order_confirmed"
  | "party_created"
  | "user_account_created"
  | "financial_intent_recorded"

export type EventDeliveryExpectation = "at_least_once"

export type EventSensitivity = "business_internal_minimized"

export interface DomainActionCatalogEntry {
  readonly kind: "DomainAction"
  readonly id: string
  readonly version: number
  readonly owningDomain: string
  readonly title: string
  readonly description: string
  readonly stability: CatalogStability
  readonly compatibilityRange: CompatibilityRange
  readonly inputSchema: CatalogSchema
  readonly outputSchema: CatalogSchema
  readonly errorSchemas: ReadonlyArray<CatalogSchema>
  readonly requiredCapability: string
  readonly scope: ReadonlyArray<string>
  readonly idempotency: ActionIdempotency
  readonly transactionSemantics: ActionTransactionSemantics
  readonly timeoutPolicy: { readonly timeoutMs: number }
  readonly retryPolicy: { readonly maxAttempts: number }
  readonly preconditions: readonly [ActionPrecondition, ...ReadonlyArray<ActionPrecondition>]
  readonly effects: readonly [ActionEffect, ...ReadonlyArray<ActionEffect>]
  readonly compensation: ActionCompensation
}

export interface DomainEventCatalogEntry {
  readonly kind: "DomainEvent"
  readonly id: string
  readonly version: number
  readonly owningDomain: string
  readonly title: string
  readonly description: string
  readonly stability: CatalogStability
  readonly compatibilityRange: CompatibilityRange
  readonly payloadSchema: CatalogSchema
  readonly scope: ReadonlyArray<string>
  readonly aggregateType: string
  readonly correlationFields: ReadonlyArray<string>
  readonly filterableFields: ReadonlyArray<string>
  readonly occurredAtSemantics: "owner_commit_time"
  readonly deliveryExpectation: EventDeliveryExpectation
  readonly sensitivity: EventSensitivity
}

export type ActionCatalogEntry = DomainActionCatalogEntry

export type EventCatalogEntry = DomainEventCatalogEntry

export const defineActionCatalogEntry = <const Entry extends DomainActionCatalogEntry>(
  entry: Entry,
): Entry => entry

export const defineEventCatalogEntry = <const Entry extends DomainEventCatalogEntry>(
  entry: Entry,
): Entry => entry
