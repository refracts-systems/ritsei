import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import postgres from "postgres"

import { uuidv7 } from "../../../foundation/ids/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]

it.effect.skipIf(databaseUrl === undefined)(
  "proves non-superuser PostgreSQL 19 control and WAIT FOR privileges",
  () => {
    const role = `ritsei_pg19_probe_${uuidv7().replaceAll("-", "")}`
    const quotedRole = `"${role}"`
    return withTemporaryDatabase(
      databaseUrl!,
      (admin, temporaryDatabaseUrl) =>
        Effect.acquireUseRelease(
          Effect.promise(async () => {
            const password = uuidv7()
            await admin.unsafe(`create role ${quotedRole} login password '${password}'`)
            const roleUrl = new URL(temporaryDatabaseUrl)
            roleUrl.username = role
            roleUrl.password = password
            return postgres(roleUrl.toString(), { max: 1 })
          }),
          (client) =>
            Effect.tryPromise({
              try: async () => {
                const [identity] = await client<{
                  session_user: string
                  current_user: string
                  is_superuser: boolean
                  can_login: boolean
                  system_identifier: string
                  timeline_id: number
                }[]>`
                select
                  session_user,
                  current_user,
                  (select rolsuper from pg_roles where rolname = current_user) as is_superuser,
                  (select rolcanlogin from pg_roles where rolname = current_user) as can_login,
                  (pg_control_system()).system_identifier::text as system_identifier,
                  (pg_control_checkpoint()).timeline_id as timeline_id
              `
                const [wait] = await client.unsafe<{ status: string }[]>(
                  "WAIT FOR LSN '0/0' WITH (MODE 'standby_replay', TIMEOUT '10ms', NO_THROW)",
                )
                return { identity, wait }
              },
              catch: (cause) => cause,
            }),
          (client) =>
            Effect.promise(async () => {
              try {
                await client.end()
              } finally {
                await admin.unsafe(`drop role ${quotedRole}`)
              }
            }),
        ).pipe(
          Effect.tap(({ identity, wait }) =>
            Effect.sync(() => {
              assert.isDefined(identity)
              assert.isDefined(wait)
              assert.strictEqual(identity.session_user, role)
              assert.strictEqual(identity.current_user, role)
              assert.strictEqual(identity.is_superuser, false)
              assert.strictEqual(identity.can_login, true)
              assert.match(identity.system_identifier, /^\d+$/)
              assert.isAbove(identity.timeline_id, 0)
              assert.strictEqual(wait.status, "not in recovery")
            })
          ),
        ),
    )
  },
)
