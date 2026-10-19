import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { Database } from "../../../foundation/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../platform/mod.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import {
  ExternalConnectorNotReviewed,
  ExternalConnectorRetired,
  ExternalIdempotencyConflict,
  makePostgresExternalGovernanceStore,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const occurredAt = "2026-08-30T00:00:00.000Z"
const retentionUntil = "2026-09-30T00:00:00.000Z"

const registerInput = (tenantId: string, version = 1) => ({
  tenantId,
  connectorId: "midtrans",
  version,
  owner: "payments-team",
  compatibilityRange: { minimumVersion: 1, maximumVersion: version },
  actor: "system-reviewer",
  idempotencyKey: `connector-register-${version}`,
  reason: "initial connector registration",
  retentionUntil,
})

const transitionInput = (
  tenantId: string,
  action: "review" | "activate" | "retire",
  idempotencyKey: string,
) => ({
  tenantId,
  connectorId: "midtrans",
  version: 1,
  action,
  actor: "system-reviewer",
  idempotencyKey,
  reason: `${action} connector after control review`,
  occurredAt,
  retentionUntil,
})

it.effect.skipIf(databaseUrl === undefined)(
  "proves durable unreviewed operation rejection, connector version, retention, and audit",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${"integration-governance-${occurredAt}"}) returning id
          `,
        )
        const database = makePostgresDatabase(client)
        const store = yield* makePostgresExternalGovernanceStore.pipe(
          Effect.provideService(Database, database),
        )

        const registered = yield* store.register(registerInput(tenant!.id))
        const duplicateRegistration = yield* store.register(registerInput(tenant!.id))
        assert.strictEqual(registered.record.status, "draft")
        assert.strictEqual(registered.record.version, 1)
        assert.strictEqual(duplicateRegistration.duplicate, true)
        assert.strictEqual(duplicateRegistration.record.id, registered.record.id)

        const unreviewed = yield* Effect.flip(
          store.transition(
            transitionInput(tenant!.id, "activate", "connector-activate-before-review"),
          ),
        )
        assert.instanceOf(unreviewed, ExternalConnectorNotReviewed)

        const reviewed = yield* store.transition(
          transitionInput(tenant!.id, "review", "connector-review-1"),
        )
        const active = yield* store.transition(
          transitionInput(tenant!.id, "activate", "connector-activate-1"),
        )
        assert.strictEqual(reviewed.record.status, "reviewed")
        assert.strictEqual(active.record.status, "active")

        const control = yield* store.recordDeliveryControl({
          tenantId: tenant!.id,
          connectorId: "midtrans",
          version: 1,
          actor: "operator-1",
          idempotencyKey: "delivery-control-1",
          reason: "retry the provider delivery",
          retentionUntil,
          control: {
            kind: "retry",
            operationId: "payment-1",
            reason: "provider recovered",
          },
        })
        const duplicateControl = yield* store.recordDeliveryControl({
          tenantId: tenant!.id,
          connectorId: "midtrans",
          version: 1,
          actor: "operator-1",
          idempotencyKey: "delivery-control-1",
          reason: "retry the provider delivery",
          retentionUntil,
          control: {
            kind: "retry",
            operationId: "payment-1",
            reason: "provider recovered",
          },
        })
        assert.strictEqual(control.audit.action, "delivery_control")
        assert.strictEqual(duplicateControl.duplicate, true)

        const retired = yield* store.transition(
          transitionInput(tenant!.id, "retire", "connector-retire-1"),
        )
        assert.strictEqual(retired.record.status, "retired")
        const retiredControl = yield* Effect.flip(
          store.recordDeliveryControl({
            tenantId: tenant!.id,
            connectorId: "midtrans",
            version: 1,
            actor: "operator-1",
            idempotencyKey: "delivery-control-after-retirement",
            reason: "retry a retired connector",
            retentionUntil,
            control: {
              kind: "retry",
              operationId: "payment-1",
              reason: "provider recovered",
            },
          }),
        )
        assert.instanceOf(retiredControl, ExternalConnectorRetired)

        const restartedStore = yield* makePostgresExternalGovernanceStore.pipe(
          Effect.provideService(Database, database),
        )
        const recovered = yield* restartedStore.get(tenant!.id, "midtrans", 1)
        assert.strictEqual(recovered?.status, "retired")
        assert.strictEqual(recovered?.version, 1)
        assert.strictEqual(recovered?.reviewedBy, "system-reviewer")

        const audit = yield* restartedStore.listAudit(tenant!.id, "midtrans", 1)
        assert.strictEqual(audit.length, 5)
        assert.deepStrictEqual(audit.map((entry) => entry.action).toSorted(), [
          "activated",
          "delivery_control",
          "registered",
          "retired",
          "reviewed",
        ])
        assert.isTrue(audit.every((entry) => entry.retentionUntil === retentionUntil))

        const conflict = yield* Effect.flip(
          restartedStore.register({
            ...registerInput(tenant!.id),
            idempotencyKey: "connector-register-conflict",
          }),
        )
        assert.instanceOf(conflict, ExternalIdempotencyConflict)
      }),
    ),
)
