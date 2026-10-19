import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { DatabaseService } from "./contract.ts"

const lsnPattern = /^[0-9A-F]+\/[0-9A-F]+$/i

export const ConsistencyToken = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
).check(Schema.isMaxLength(4_096))
export type ConsistencyToken = Schema.Schema.Type<typeof ConsistencyToken>

export type PostgresReadYourWritesConfig = {
  readonly placementId: string
  readonly secret: string
  readonly maxWaitMs: number
  readonly tokenTtlMs: number
}

export class ReplicaConsistencyFailure extends Schema.TaggedError<ReplicaConsistencyFailure>()(
  "ReplicaConsistencyFailure",
  {
    reason: Schema.Literals([
      "disabled",
      "invalid_configuration",
      "capture_failed",
      "invalid_token",
      "expired_token",
      "tenant_mismatch",
      "placement_mismatch",
      "timeline_mismatch",
      "timeout",
      "not_in_recovery",
      "wait_failed",
    ]),
  },
) {}

export interface PostgresReadYourWritesService {
  readonly capture: (tenantId: string) => Effect.Effect<ConsistencyToken, ReplicaConsistencyFailure>
  readonly wait: (
    tenantId: string,
    token: string,
  ) => Effect.Effect<DatabaseService, ReplicaConsistencyFailure>
}

export const PostgresReadYourWrites = Context.Service<PostgresReadYourWritesService>(
  "RITSEI/PostgresReadYourWrites",
)

export const CurrentConsistencyToken = Context.Reference<string | undefined>(
  "RITSEI/CurrentConsistencyToken",
  { defaultValue: () => undefined },
)

export const isConsistencyLsn = (value: string) => lsnPattern.test(value)
