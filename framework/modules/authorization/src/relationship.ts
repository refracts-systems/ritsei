import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { and, eq } from "drizzle-orm"
import { tenantMemberships } from "../../../../db/schema/authorization.ts"
import { Database, type DatabaseService } from "../../../foundation/mod.ts"
import { Principal } from "../../auth/mod.ts"

export const RelationshipInput = Schema.Struct({
  principal: Principal,
  tenantId: Schema.String,
  resourceType: Schema.String,
  resourceId: Schema.String,
  relationship: Schema.String,
})
export type RelationshipInput = Schema.Schema.Type<typeof RelationshipInput>

export const RelationshipResult = Schema.Literals([
  "allowed",
  "denied",
  "unknown",
  "stale",
  "unavailable",
])
export type RelationshipResult = Schema.Schema.Type<typeof RelationshipResult>

export const RelationshipDecision = Schema.Struct({
  allowed: Schema.Boolean,
  result: RelationshipResult,
  tenantId: Schema.String,
  resourceType: Schema.String,
  resourceId: Schema.String,
  relationship: Schema.String,
  reason: Schema.String,
  consistency: Schema.Literals(["current", "stale", "unknown", "unavailable"]),
})
export type RelationshipDecision = Schema.Schema.Type<typeof RelationshipDecision>

export interface RelationshipEngine {
  readonly evaluate: (
    input: Schema.Codec.Encoded<typeof RelationshipInput>,
  ) => Effect.Effect<
    RelationshipDecision,
    Schema.SchemaError | import("../../../foundation/mod.ts").DatabaseFailure
  >
}

export const RelationshipEngine = Context.Service<RelationshipEngine>("RITSEI/RelationshipEngine")

const denied = (input: RelationshipInput, reason: string): RelationshipDecision => ({
  allowed: false,
  result: "denied",
  ...input,
  reason,
  consistency: "current",
})

const unavailable = (
  input: RelationshipInput,
  result: "stale" | "unavailable",
): RelationshipDecision => ({
  allowed: false,
  result,
  ...input,
  reason: result === "stale" ? "RELATIONSHIP_STALE" : "RELATIONSHIP_UNAVAILABLE",
  consistency: result,
})

const unknown = (input: RelationshipInput): RelationshipDecision => ({
  allowed: false,
  result: "unknown",
  ...input,
  reason: "RELATIONSHIP_UNKNOWN",
  consistency: "unknown",
})

export const makeMemoryRelationshipEngine = (
  allowedRelationships: ReadonlyArray<RelationshipInput> = [],
  defaultResult: RelationshipResult = "denied",
): RelationshipEngine => {
  const allowed = new Set(allowedRelationships.map((input) => relationshipKey(input)))
  return {
    evaluate: Effect.fn("RelationshipEngine.evaluate")(function* (
      input: Schema.Codec.Encoded<typeof RelationshipInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(RelationshipInput)(input)
      if (defaultResult === "stale" || defaultResult === "unavailable") {
        return unavailable(decoded, defaultResult)
      }
      if (decoded.resourceType !== "tenant" || decoded.relationship !== "member") {
        return unknown(decoded)
      }
      return allowed.has(relationshipKey(decoded))
        ? {
            allowed: true,
            result: "allowed",
            ...decoded,
            reason: "RELATIONSHIP_ALLOWED",
            consistency: "current",
          }
        : denied(decoded, "RELATIONSHIP_DENIED")
    }),
  }
}

export const makePostgresRelationshipEngine = (database: DatabaseService): RelationshipEngine => ({
  evaluate: Effect.fn("RelationshipEngine.evaluate")(function* (
    input: Schema.Codec.Encoded<typeof RelationshipInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(RelationshipInput)(input)
    if (decoded.resourceType !== "tenant" || decoded.relationship !== "member") {
      return unknown(decoded)
    }
    if (decoded.resourceId !== decoded.tenantId) return denied(decoded, "RELATIONSHIP_DENIED")
    const member = yield* database
      .query(
        (db) =>
          db
            .select({ userAccountId: tenantMemberships.userAccountId })
            .from(tenantMemberships)
            .where(
              and(
                eq(tenantMemberships.userAccountId, decoded.principal.userAccountId),
                eq(tenantMemberships.tenantId, decoded.tenantId),
                eq(tenantMemberships.status, "active"),
              ),
            ),
        "authorization.relationship.check",
      )
      .pipe(
        Effect.map((rows) => rows[0]),
        Effect.catchTag("DatabaseFailure", () => Effect.succeed(undefined)),
      )
    return member === undefined
      ? denied(decoded, "RELATIONSHIP_DENIED")
      : {
          allowed: true,
          result: "allowed",
          ...decoded,
          reason: "RELATIONSHIP_ALLOWED",
          consistency: "current",
        }
  }),
})

const relationshipKey = (input: RelationshipInput) =>
  `${input.principal.userAccountId}:${input.tenantId}:${input.resourceType}:${input.resourceId}:${input.relationship}`

export const makeRelationshipEngine = Effect.gen(function* () {
  return makePostgresRelationshipEngine(yield* Database)
})
