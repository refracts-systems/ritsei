import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Database, uuidv7 } from "../../../foundation/mod.ts"
import { makePostgresDatabase, runMigrations, WebCryptoLive } from "../../../platform/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"
import { makeAuthService } from "../../auth/mod.ts"
import { makeUserAccountService, UserAccountService } from "../../identity/mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const latestMigration = "20260808045828_capability_naming_conventions"

const withPreviousMigrations = <A, E, R>(
  use: (directory: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.promise(async () => {
      const directory = await mkdtemp(join(tmpdir(), "ritsei-migrations-"))
      for (const entry of await readdir("db/migrations", { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name >= latestMigration) continue
        const source = `db/migrations/${entry.name}`
        const target = `${directory}/${entry.name}`
        await mkdir(target, { recursive: true })
        await copyFile(`${source}/migration.sql`, `${target}/migration.sql`)
        await copyFile(`${source}/snapshot.json`, `${target}/snapshot.json`)
      }
      return directory
    }),
    use,
    (directory) => Effect.promise(() => rm(directory, { recursive: true })),
  )

it.effect.skipIf(databaseUrl === undefined)(
  "migrates legacy capability grants to canonical identifiers",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function*() {
        yield* withPreviousMigrations((directory) => runMigrations(client, directory))

        const database = makePostgresDatabase(client)
        const userAccounts = yield* makeUserAccountService.pipe(
          Effect.provideService(Database, database),
        )
        const user = yield* userAccounts.create({ email: "capability-migration@example.test" })
        const auth = yield* makeAuthService.pipe(
          Effect.provideService(Database, database),
          Effect.provide(WebCryptoLive),
          Effect.provideService(UserAccountService, userAccounts),
        )
        const tenant = yield* auth.createTenant({ slug: `capability-${uuidv7()}` })
        const legacyCapabilities = [
          "auth.capability.grant",
          "user_account.write",
          "user_account.membership.manage",
          "party.representation.write",
          "party.role.assign",
          "inventory.stock.transfer.confirm",
        ]

        yield* Effect.promise(() =>
          client`
          insert into "authorization"."tenant_memberships" (user_account_id, tenant_id)
          values (${user.id}, ${tenant.id})
        `
        )
        yield* Effect.promise(async () => {
          for (const capability of legacyCapabilities) {
            await client`
              insert into "authorization"."memberships" (user_account_id, tenant_id, capability)
              values (${user.id}, ${tenant.id}, ${capability})
            `
          }
        })

        yield* runMigrations(client)

        const rows = yield* Effect.promise(() =>
          client<{ capability: string }[]>`
          select capability
          from "authorization"."memberships"
          where user_account_id = ${user.id} and tenant_id = ${tenant.id}
          order by capability
        `
        )
        assert.deepStrictEqual(rows.map(({ capability }) => capability), [
          "authorization.capability.grant",
          "authorization.tenant_membership.activate",
          "authorization.tenant_membership.add",
          "authorization.tenant_membership.read",
          "authorization.tenant_membership.remove",
          "authorization.tenant_membership.suspend",
          "identity.user_account.create",
          "identity.user_account.update",
          "inventory.stock_transfer.confirm",
          "party.party_representation.activate",
          "party.party_representation.create",
          "party.party_representation.deactivate",
          "party.party_role.assign",
        ])
      })),
)
