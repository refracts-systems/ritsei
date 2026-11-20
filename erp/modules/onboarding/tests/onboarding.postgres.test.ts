import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Sql } from "postgres"

import { Database, DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import {
  AuthorizationService,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import { makeMessagingService } from "../../../../framework/modules/messaging/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../../framework/platform/mod.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import {
  makePartyService,
  PartyCapabilities,
  PartyEventPublisher,
  PartyService,
  type PartyServiceContract,
} from "../../party/mod.ts"
import {
  makeOnboardingService,
  OnboardingCapabilities,
  PartyMappingRevision,
  type OnboardingServiceContract,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]

const principal = { userAccountId: "onboarding-integration", sessionId: "session" }

const csv = (...lines: ReadonlyArray<string>) => ["source_id,kind,name,role", ...lines].join("\n")

const base = [
  "C-1,organization,PT Maju Jaya,customer",
  "C-2,organization,CV Sumber Rejeki,supplier",
  "C-3,person,Budi Santoso,customer",
]

const counts = (client: Sql, tenantId: string) =>
  Effect.promise(async () => {
    const [row] = await client<
      { parties: number; events: number; identities: number; applied: number }[]
    >`
      select
        (select count(*)::int from party.parties where tenant_id = ${tenantId}) as parties,
        (select count(*)::int from messaging.event_outbox
          where tenant_id = ${tenantId} and event_type = 'party.created') as events,
        (select count(*)::int from onboarding.source_identities
          where tenant_id = ${tenantId}) as identities,
        (select count(*)::int from onboarding.import_rows
          where tenant_id = ${tenantId} and status = 'applied') as applied
    `

    return row!
  })

/** A tenant, grants for the operator, and the real services on a freshly migrated database. */
const withServices = <A, E>(
  use: (services: {
    readonly client: Sql
    readonly tenantId: string
    readonly onboarding: OnboardingServiceContract
    readonly party: PartyServiceContract
  }) => Effect.Effect<A, E>,
  decorate: (real: PartyServiceContract) => PartyServiceContract = (real) => real,
) =>
  withTemporaryDatabase(databaseUrl!, (client) =>
    Effect.gen(function* () {
      yield* runMigrations(client)
      const database = makePostgresDatabase(client)

      const [tenant] = yield* Effect.promise(
        () =>
          client<
            { id: string }[]
          >`insert into auth.tenants (slug) values ('onboarding') returning id`,
      )

      const tenantId = tenant!.id

      yield* Effect.gen(function* () {
        const authorization = yield* AuthorizationService

        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, database),
        )

        const realParty = yield* makePartyService.pipe(
          Effect.provideService(Database, database),
          Effect.provideService(AuthorizationService, authorization),
          Effect.provideService(PartyEventPublisher, { append: messaging.append }),
        )

        const party = decorate(realParty)

        const onboarding = yield* makeOnboardingService.pipe(
          Effect.provideService(Database, database),
          Effect.provideService(AuthorizationService, authorization),
          Effect.provideService(PartyService, party),
        )

        return yield* use({ client, tenantId, onboarding, party })
      }).pipe(
        Effect.provide(
          makeAuthorizationTestLayer(
            [
              ...Object.values(OnboardingCapabilities),
              PartyCapabilities.partyCreate,
              PartyCapabilities.partyRoleAssign,
              PartyCapabilities.partyRead,
            ].map((capability) => ({
              userAccountId: principal.userAccountId,
              tenantId,
              capability,
            })),
          ),
        ),
      )
    }),
  )

it.effect.skipIf(databaseUrl === undefined)(
  "keeps rejected source ids out of staging and hides them on existing invalid rows",
  () =>
    withServices(({ client, tenantId, onboarding }) =>
      Effect.gen(function* () {
        const ref = { principal, tenantId }
        const oversizedSourceId = "X".repeat(132_000)

        const staged = yield* onboarding.stage({
          ...ref,
          sourceInstance: "accurate-prod",
          objectKind: "party",
          mappingRevision: PartyMappingRevision,
          csv: csv(base[0]!, `${oversizedSourceId},person,Rejected Name,`),
        })

        const batchId = staged.summary.batch.id

        const stored = yield* Effect.promise(
          () =>
            client<{ source_id: string }[]>`
              select source_id from onboarding.import_rows
              where tenant_id = ${tenantId} and batch_id = ${batchId} order by row_number
            `,
        )

        assert.deepStrictEqual(
          stored.map((row) => row.source_id),
          ["C-1", ""],
        )

        // Simulate a rejected row staged by the previous parser.
        yield* Effect.promise(
          () => client`
            update onboarding.import_rows set source_id = ${oversizedSourceId}
            where tenant_id = ${tenantId} and batch_id = ${batchId} and status = 'invalid'
          `,
        )

        const rows = yield* onboarding.listRows({ ...ref, batchId })

        assert.deepStrictEqual(
          rows.map((row) => row.sourceId),
          ["C-1", ""],
        )
        assert.deepStrictEqual(
          rows[1]?.errors.map((error) => error.code),
          ["source_id_too_long"],
        )
      }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "rolls back an interrupted record with its owner write and resumes without duplicates",
  () => {
    let roleAssignments = 0

    return withServices(
      ({ client, tenantId, onboarding, party }) =>
        Effect.gen(function* () {
          const ref = { principal, tenantId }

          const stage = (...lines: ReadonlyArray<string>) =>
            onboarding.stage({
              ...ref,
              sourceInstance: "accurate-prod",
              objectKind: "party",
              mappingRevision: PartyMappingRevision,
              csv: csv(...lines),
            })

          const staged = yield* stage(...base)
          const batchId = staged.summary.batch.id

          yield* onboarding.rehearse({ ...ref, batchId })

          // The rehearsal committed no owner write, event, or identity.
          assert.deepStrictEqual(yield* counts(client, tenantId), {
            parties: 0,
            events: 0,
            identities: 0,
            applied: 0,
          })

          // The second record's role step fails after its Party insert and outbox event, inside the
          // record's transaction. Everything from that record must roll back together.
          const failure = yield* Effect.flip(onboarding.apply({ ...ref, batchId }))

          assert.instanceOf(failure, DatabaseFailure)
          assert.deepStrictEqual(yield* counts(client, tenantId), {
            parties: 1,
            events: 1,
            identities: 1,
            applied: 1,
          })

          const resumed = yield* onboarding.apply({ ...ref, batchId })

          assert.strictEqual(resumed.created, 2)
          assert.strictEqual(resumed.summary.batch.status, "applied")
          assert.deepStrictEqual(yield* counts(client, tenantId), {
            parties: 3,
            events: 3,
            identities: 3,
            applied: 3,
          })

          const again = yield* onboarding.apply({ ...ref, batchId })

          assert.strictEqual(again.created + again.linked, 0)

          const sameFile = yield* stage(...base)

          assert.isTrue(sameFile.alreadyStaged)
          assert.strictEqual(sameFile.summary.batch.id, batchId)

          // A different file that repeats C-1 to C-3 unchanged links them and creates only C-4.
          const next = yield* stage(...base, "C-4,person,Siti Aminah,")

          yield* onboarding.rehearse({ ...ref, batchId: next.summary.batch.id })

          const linked = yield* onboarding.apply({ ...ref, batchId: next.summary.batch.id })

          assert.deepStrictEqual([linked.created, linked.linked], [1, 3])
          assert.lengthOf(yield* party.list({ ...ref }), 4)
          assert.strictEqual((yield* counts(client, tenantId)).identities, 4)
        }),
      (real) => ({
        ...real,
        assignRole: (input) =>
          ++roleAssignments === 2
            ? Effect.fail(new DatabaseFailure({ operation: "party.assign_role", cause: "lost" }))
            : real.assignRole(input),
      }),
    )
  },
)

it.effect.skipIf(databaseUrl === undefined)(
  "the identity map's unique key stops two imports from creating the same record",
  () =>
    withServices(({ client, tenantId, onboarding }) =>
      Effect.gen(function* () {
        const ref = { principal, tenantId }

        const prepare = (...lines: ReadonlyArray<string>) =>
          Effect.gen(function* () {
            const staged = yield* onboarding.stage({
              ...ref,
              sourceInstance: "accurate-prod",
              objectKind: "party",
              mappingRevision: PartyMappingRevision,
              csv: csv(...lines),
            })

            yield* onboarding.rehearse({ ...ref, batchId: staged.summary.batch.id })

            return staged.summary.batch.id
          })

        const first = yield* prepare(...base)
        const second = yield* prepare("C-0,person,Early Bird,", ...base)

        const results = yield* Effect.all(
          [
            onboarding.apply({ ...ref, batchId: first }),
            onboarding.apply({ ...ref, batchId: second }),
          ],
          { concurrency: 2 },
        )

        assert.strictEqual(results[0].created + results[1].created, 4)
        assert.strictEqual(results[0].linked + results[1].linked, 3)
        assert.deepStrictEqual(
          results.map((result) => result.summary.batch.status),
          ["applied", "applied"],
        )
        assert.deepStrictEqual(yield* counts(client, tenantId), {
          parties: 4,
          events: 4,
          identities: 4,
          applied: 7,
        })
      }),
    ),
)
