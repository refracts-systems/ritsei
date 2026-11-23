import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { bankStatementChecksum } from "../src/bank-statement.ts"
import {
  BankStatement,
  ImportStatement,
  InvalidBankStatement,
  Settlement,
  StatementImported,
  statementId,
} from "../src/domain-model.ts"

const { Story } = Domain

const story = Story.make(Settlement)

const tenantA = "00000000-0000-7000-8000-00000000000a"
const tenantB = "00000000-0000-7000-8000-00000000000b"
const entity = "00000000-0000-7000-8000-0000000000e1"
const otherEntity = "00000000-0000-7000-8000-0000000000e2"
const bank = "00000000-0000-7000-8000-0000000000b1"
const otherBank = "00000000-0000-7000-8000-0000000000b2"

const header = "date,description,reference,amount"
const content = `${header}\n2026-10-01,Transfer,INV-1,10.00`
const otherContent = `${header}\n2026-10-01,Transfer,INV-1,10.01`

const imported = new StatementImported({
  lines: [
    {
      lineNumber: 1,
      bookingDate: "2026-10-01",
      description: "Transfer",
      reference: "INV-1",
      amount: "10.00",
    },
  ],
})

const refOf = (tenantId: string, legalEntityId: string, bankAccountId: string, text: string) =>
  bankStatementChecksum(text).pipe(
    Effect.map((checksum) =>
      BankStatement.ref(statementId({ tenantId, legalEntityId, bankAccountId, checksum })),
    ),
  )

describe("Settlement derived ids on Alchemy", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(Settlement), []))

  // [SET-BANK-2]
  it.effect("importing the same file again returns the statement and records nothing", () =>
    Effect.gen(function* () {
      const first = yield* refOf(tenantA, entity, bank, content)
      const again = yield* refOf(tenantA, entity, bank, content)

      assert.strictEqual(again.id, first.id)

      yield* story(
        Story.when(first, new ImportStatement({ content })),
        Story.then(first, imported),
        Story.when(again, new ImportStatement({ content })),
        Story.then(again),
      )
    }),
  )

  // [SET-BANK-2]
  it.effect("a file with different content is another statement, imported on its own", () =>
    Effect.gen(function* () {
      const first = yield* refOf(tenantA, entity, bank, content)
      const second = yield* refOf(tenantA, entity, bank, otherContent)

      assert.notStrictEqual(second.id, first.id)

      yield* story(
        Story.given(first, imported),
        Story.when(second, new ImportStatement({ content: otherContent })),
        Story.then(
          second,
          new StatementImported({ lines: [{ ...imported.lines[0]!, amount: "10.01" }] }),
        ),
      )
    }),
  )

  // [SET-BANK-2]
  it.effect("the key depends on tenant, legal entity, and bank account", () =>
    Effect.gen(function* () {
      const base = yield* refOf(tenantA, entity, bank, content)

      const keys = [
        yield* refOf(tenantB, entity, bank, content),
        yield* refOf(tenantA, otherEntity, bank, content),
        yield* refOf(tenantA, entity, otherBank, content),
      ].map((ref) => ref.id)

      assert.strictEqual(new Set([base.id, ...keys]).size, 4)

      const foreign = yield* refOf(tenantB, entity, bank, content)

      yield* story(
        Story.given(base, imported),
        Story.when(foreign, new ImportStatement({ content })),
        Story.then(foreign, imported),
      )
    }),
  )

  // [SET-BANK-2]
  it.effect("a broken file is still rejected for an instance that already holds a statement", () =>
    Effect.gen(function* () {
      const ref = yield* refOf(tenantA, entity, bank, content)

      yield* story(
        Story.given(ref, imported),
        Story.when(ref, new ImportStatement({ content: `${header}\n2026-10-01,Line,,0` })),
        Story.rejected(new InvalidBankStatement({ row: 2, reason: "amount must not be zero" })),
      )
    }),
  )
})
