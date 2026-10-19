import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Database, uuidv7 } from "../../../../framework/foundation/mod.ts"
import {
  AuthorizationDenied,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../../framework/platform/mod.ts"
import { grantsFor, seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import {
  makePartyContactsTestLayer,
  PartyBankAccountAlreadyExists,
  PartyCapabilities,
  PartyContactService,
  PartyContactsLive,
  PartyNotFound,
} from "../mod.ts"

const principal = { userAccountId: "contacts-user", sessionId: "contacts-session" }
const tenantId = "018f2000-0000-7000-8000-0000000000d1"
const partyId = "018f2000-0000-7000-8000-0000000000d2"
const capabilities = [
  PartyCapabilities.partyRead,
  PartyCapabilities.partyAddressAdd,
  PartyCapabilities.partyContactAdd,
  PartyCapabilities.partyBankAccountAdd,
]

/** The same contract runs against the memory store and PostgreSQL. */
const exerciseContactBook = (scope: { tenantId: string; partyId: string }) =>
  Effect.gen(function* () {
    const contacts = yield* PartyContactService
    const base = { principal, ...scope }
    yield* contacts.addAddress({
      ...base,
      purpose: "billing",
      line1: "Jl. Sudirman 1",
      city: "Jakarta",
      countryCode: "ID",
      primary: true,
    })
    const second = yield* contacts.addAddress({
      ...base,
      purpose: "billing",
      line1: "Jl. Thamrin 2",
      city: "Jakarta",
      postalCode: "10230",
      countryCode: "ID",
      primary: true,
    })
    yield* contacts.addAddress({
      ...base,
      purpose: "shipping",
      line1: "Kawasan Industri 3",
      city: "Bekasi",
      countryCode: "ID",
    })
    const contact = yield* contacts.addContact({
      ...base,
      name: "Siti Rahma",
      jobTitle: "Finance",
      email: "siti@example.test",
    })
    const account = yield* contacts.addBankAccount({
      ...base,
      bankName: "Bank Central",
      accountNumber: "1234567890",
      accountHolder: "PT Contoh",
      currency: "IDR",
    })
    const duplicate = yield* Effect.flip(
      contacts.addBankAccount({
        ...base,
        bankName: "Bank Central",
        accountNumber: "1234567890",
        accountHolder: "PT Contoh",
        currency: "IDR",
      }),
    )
    assert.instanceOf(duplicate, PartyBankAccountAlreadyExists)
    const unknownParty = yield* Effect.flip(
      contacts.addContact({ ...base, partyId: uuidv7(), name: "Nobody" }),
    )
    assert.instanceOf(unknownParty, PartyNotFound)
    const badCountry = yield* Effect.flip(
      contacts.addAddress({
        ...base,
        purpose: "billing",
        line1: "x",
        city: "y",
        countryCode: "id",
      }),
    )
    assert.strictEqual(badCountry._tag, "SchemaError")

    const book = yield* contacts.getContactBook(base)
    const billing = book.addresses.filter((address) => address.purpose === "billing")
    assert.deepStrictEqual(
      billing.map((address) => [address.line1, address.primary]),
      [
        ["Jl. Sudirman 1", false],
        ["Jl. Thamrin 2", true],
      ],
    )
    assert.strictEqual(second.postalCode, "10230")
    assert.deepStrictEqual(book.contacts, [contact])
    assert.deepStrictEqual(book.bankAccounts, [account])
  })

describe("party contact book", () => {
  it.effect("keeps one primary address per purpose and unique bank accounts", () =>
    exerciseContactBook({ tenantId, partyId }).pipe(
      Effect.provide(
        makePartyContactsTestLayer(
          (tenant, party) => tenant === tenantId && party === partyId,
        ).pipe(
          Layer.provide(
            makeAuthorizationTestLayer(grantsFor(principal.userAccountId, tenantId, capabilities)),
          ),
        ),
      ),
    ),
  )

  it.effect("denies changes without the capability", () =>
    Effect.gen(function* () {
      const contacts = yield* PartyContactService
      const denied = yield* Effect.flip(
        contacts.addContact({ principal, tenantId, partyId, name: "Siti" }),
      )
      assert.instanceOf(denied, AuthorizationDenied)
    }).pipe(
      Effect.provide(
        makePartyContactsTestLayer().pipe(
          Layer.provide(
            makeAuthorizationTestLayer(
              grantsFor(principal.userAccountId, tenantId, [PartyCapabilities.partyRead]),
            ),
          ),
        ),
      ),
    ),
  )
})

const databaseUrl = process.env["DATABASE_URL"]

it.effect.skipIf(databaseUrl === undefined)(
  "enforces the contact book invariants in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const fixture = yield* seedErpFixture(client)
        const layer = PartyContactsLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Database, makePostgresDatabase(client)),
              makeAuthorizationTestLayer(
                grantsFor(principal.userAccountId, fixture.tenantId, capabilities),
              ),
            ),
          ),
        )
        yield* exerciseContactBook({
          tenantId: fixture.tenantId,
          partyId: fixture.organizationId,
        }).pipe(Effect.provide(layer))

        const secondPrimary = yield* Effect.tryPromise({
          try: () => client`
            update party.party_addresses set is_primary = true
            where tenant_id = ${fixture.tenantId} and purpose = 'billing'
          `,
          catch: (cause) => cause as { constraint_name?: string },
        }).pipe(Effect.flip)
        assert.strictEqual(secondPrimary.constraint_name, "party_addresses_primary_purpose_key")
      }),
    ),
  { timeout: 120_000 },
)
