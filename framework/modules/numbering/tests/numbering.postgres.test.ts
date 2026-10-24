import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { Database, uuidv7 } from "../../../foundation/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../platform/mod.ts"
import { makeNumberingService } from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]

class RolledBack {
  readonly _tag = "RolledBack"
}

it.effect.skipIf(databaseUrl === undefined)(
  "keeps series gapless across rollbacks, retries, and concurrent allocation",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)

        const [tenant] = yield* Effect.promise(
          () =>
            client<
              { id: string }[]
            >`insert into auth.tenants (slug) values (${uuidv7()}) returning id`,
        )

        const database = makePostgresDatabase(client)

        const numbering = yield* makeNumberingService().pipe(
          Effect.provideService(Database, database),
        )

        const scopeId = uuidv7()

        const request = (documentId = uuidv7()) => ({
          tenantId: tenant!.id,
          scopeId,
          documentType: "accounting.journal",
          documentId,
          documentDate: "2026-10-20",
          fiscalYearStartMonth: 1,
          prefix: "JE/",
        })

        const first = yield* numbering.allocate(request())
        assert.strictEqual(first.number, "JE/2026/00001")

        // A number allocated inside a rolled-back document transaction is returned to the series.
        const rolledBack = yield* database
          .withTransaction(
            Effect.gen(function* () {
              const allocated = yield* numbering.allocate(request())
              assert.strictEqual(allocated.value, 2)

              return yield* Effect.fail(new RolledBack())
            }),
          )
          .pipe(Effect.flip)

        assert.instanceOf(rolledBack, RolledBack)

        const documentId = uuidv7()
        const second = yield* numbering.allocate(request(documentId))
        const retried = yield* numbering.allocate(request(documentId))
        assert.strictEqual(second.number, "JE/2026/00002")
        assert.deepStrictEqual(retried, second)

        const concurrent = yield* Effect.forEach(
          Array.from({ length: 8 }, () => request()),
          (input) => numbering.allocate(input),
          { concurrency: 4 },
        )

        assert.deepStrictEqual(
          concurrent.map((allocated) => allocated.value).toSorted((left, right) => left - right),
          [3, 4, 5, 6, 7, 8, 9, 10],
        )

        const issued = yield* Effect.promise(
          () =>
            client<{ value: string }[]>`
              select value::text as value from numbering.issued_numbers order by issued_numbers.value
            `,
        )

        assert.deepStrictEqual(
          issued.map((row) => Number(row.value)),
          Array.from({ length: 10 }, (_, index) => index + 1),
        )
      }),
    ),
  { timeout: 120_000 },
)
