import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Database, uuidv7 } from "../../../../framework/foundation/mod.ts"
import { makeAuthorizationTestLayer } from "../../../../framework/modules/authorization/mod.ts"
import {
  makeMessagingService,
  MessagingService,
} from "../../../../framework/modules/messaging/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../../framework/platform/mod.ts"
import { partial } from "../../../../tests/support/partial.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { AccountingCapabilities, makeAccountingService, UnbalancedJournal } from "../mod.ts"
import { SalesService } from "../../sales/mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "balance-boundary", sessionId: "session" }

// [ACC-JNL-1]
it.effect.skipIf(databaseUrl === undefined)(
  "rejects a journal that is one cent out of balance with the typed error and records nothing",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)

        const [tenant] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into auth.tenants (slug) values (${uuidv7()}) returning id
            `,
        )

        const accounts = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.accounts (tenant_id, code, name, type)
              values
                (${tenant!.id}, 'BAL-CASH', 'Cash', 'asset'),
                (${tenant!.id}, 'BAL-EQUITY', 'Equity', 'equity')
              returning id
            `,
        )

        const database = makePostgresDatabase(client)

        const requirements = Layer.mergeAll(
          Layer.succeed(Database, database),
          makeAuthorizationTestLayer([
            {
              userAccountId: principal.userAccountId,
              tenantId: tenant!.id,
              capability: AccountingCapabilities.journalPost,
            },
          ]),
          Layer.succeed(
            MessagingService,
            yield* makeMessagingService.pipe(Effect.provideService(Database, database)),
          ),
          Layer.succeed(SalesService, partial<SalesService>()({})),
        )

        const accounting = yield* Effect.provide(makeAccountingService, requirements)

        const error = yield* Effect.flip(
          accounting.postJournal({
            principal,
            tenantId: tenant!.id,
            reference: "BAL-ONE-CENT",
            lines: [
              { accountId: accounts[0]!.id, debit: "10.00", credit: "0" },
              { accountId: accounts[1]!.id, debit: "0", credit: "9.99" },
            ],
          }),
        )

        assert.instanceOf(error, UnbalancedJournal)

        const [count] = yield* Effect.promise(
          () =>
            client<{ n: number }[]>`
              select count(*)::int as n from accounting.journal_entries
              where tenant_id = ${tenant!.id}
            `,
        )

        assert.strictEqual(count!.n, 0)
      }),
    ),
)
