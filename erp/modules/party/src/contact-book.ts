import type { CapabilityType } from "../../../../framework/modules/authorization/mod.ts"
import { and, asc, eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { partyAddresses, partyBankAccounts, partyContacts } from "../../../../db/schema/party.ts"
import {
  Database,
  type DatabaseFailure,
  isDatabaseConstraint,
  uuidv7,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import {
  type AuthorizationDenied,
  AuthorizationService,
} from "../../../../framework/modules/authorization/mod.ts"
import { PartyCapabilities } from "./capabilities.ts"
import { PartyBankAccountAlreadyExists, PartyNotFound } from "./errors.ts"

const Uuid = Schema.String.check(Schema.isUUID())

const Text = Schema.String.check(
  Schema.makeFilter((value) => /\S/.test(value) && value === value.trim() && value.length <= 256, {
    expected: "a trimmed nonblank text of at most 256 characters",
  }),
)

const Email = Schema.String.check(
  Schema.makeFilter((value) => /^[^\s@]+@[^\s@]+$/.test(value) && value === value.toLowerCase(), {
    expected: "a lowercase email address",
  }),
)

export const AddressPurpose = Schema.Literals(["billing", "shipping", "registered"])

export const PartyAddress = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  partyId: Uuid,
  purpose: AddressPurpose,
  line1: Text,
  line2: Schema.NullOr(Text),
  city: Text,
  region: Schema.NullOr(Text),
  postalCode: Schema.NullOr(Text),
  countryCode: Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/)),
  primary: Schema.Boolean,
})

export type PartyAddress = Schema.Schema.Type<typeof PartyAddress>

export const PartyContact = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  partyId: Uuid,
  name: Text,
  jobTitle: Schema.NullOr(Text),
  email: Schema.NullOr(Email),
  phone: Schema.NullOr(Text),
})

export type PartyContact = Schema.Schema.Type<typeof PartyContact>

export const PartyBankAccount = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  partyId: Uuid,
  bankName: Text,
  accountNumber: Schema.String.check(
    Schema.isPattern(/^[A-Za-z0-9](?:[A-Za-z0-9 -]*[A-Za-z0-9])?$/),
  ),
  accountHolder: Text,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
})

export type PartyBankAccount = Schema.Schema.Type<typeof PartyBankAccount>

export const PartyContactBook = Schema.Struct({
  partyId: Uuid,
  addresses: Schema.Array(PartyAddress),
  contacts: Schema.Array(PartyContact),
  bankAccounts: Schema.Array(PartyBankAccount),
})

export type PartyContactBook = Schema.Schema.Type<typeof PartyContactBook>

const PartyScope = { principal: Principal, tenantId: Uuid, partyId: Uuid }

export const AddPartyAddressInput = Schema.Struct({
  ...PartyScope,
  purpose: AddressPurpose,
  line1: Text,
  line2: Schema.optionalKey(Text),
  city: Text,
  region: Schema.optionalKey(Text),
  postalCode: Schema.optionalKey(Text),
  countryCode: PartyAddress.fields.countryCode,
  /** A primary address replaces the previous primary address for the same purpose. */
  primary: Schema.optionalKey(Schema.Boolean),
})

export const AddPartyContactInput = Schema.Struct({
  ...PartyScope,
  name: Text,
  jobTitle: Schema.optionalKey(Text),
  email: Schema.optionalKey(Email),
  phone: Schema.optionalKey(Text),
})

export const AddPartyBankAccountInput = Schema.Struct({
  ...PartyScope,
  bankName: Text,
  accountNumber: PartyBankAccount.fields.accountNumber,
  accountHolder: Text,
  currency: PartyBankAccount.fields.currency,
})

export const GetPartyContactBookInput = Schema.Struct(PartyScope)

type AddAddressCommand = Omit<Schema.Schema.Type<typeof AddPartyAddressInput>, "principal">

type AddContactCommand = Omit<Schema.Schema.Type<typeof AddPartyContactInput>, "principal">

type AddBankAccountCommand = Omit<Schema.Schema.Type<typeof AddPartyBankAccountInput>, "principal">

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

/** Addresses, contact persons, and bank accounts of a party (parity plan Phase 4). */
export interface PartyContactService {
  readonly addAddress: (
    input: Schema.Codec.Encoded<typeof AddPartyAddressInput>,
  ) => Effect.Effect<PartyAddress, PartyNotFound | CommonFailure>
  readonly addContact: (
    input: Schema.Codec.Encoded<typeof AddPartyContactInput>,
  ) => Effect.Effect<PartyContact, PartyNotFound | CommonFailure>
  readonly addBankAccount: (
    input: Schema.Codec.Encoded<typeof AddPartyBankAccountInput>,
  ) => Effect.Effect<
    PartyBankAccount,
    PartyNotFound | PartyBankAccountAlreadyExists | CommonFailure
  >
  readonly getContactBook: (
    input: Schema.Codec.Encoded<typeof GetPartyContactBookInput>,
  ) => Effect.Effect<PartyContactBook, CommonFailure>
}

export const PartyContactService = Context.Service<PartyContactService>(
  "RITSEI/PartyContactService",
)

interface ContactBookStore {
  readonly addAddress: (
    command: AddAddressCommand,
  ) => Effect.Effect<PartyAddress, PartyNotFound | DatabaseFailure>
  readonly addContact: (
    command: AddContactCommand,
  ) => Effect.Effect<PartyContact, PartyNotFound | DatabaseFailure>
  readonly addBankAccount: (
    command: AddBankAccountCommand,
  ) => Effect.Effect<
    PartyBankAccount,
    PartyNotFound | PartyBankAccountAlreadyExists | DatabaseFailure
  >
  readonly getContactBook: (
    tenantId: string,
    partyId: string,
  ) => Effect.Effect<PartyContactBook, DatabaseFailure>
}

const addressValues = (command: AddAddressCommand) => ({
  tenantId: command.tenantId,
  partyId: command.partyId,
  purpose: command.purpose,
  line1: command.line1,
  line2: command.line2 ?? null,
  city: command.city,
  region: command.region ?? null,
  postalCode: command.postalCode ?? null,
  countryCode: command.countryCode,
  primary: command.primary ?? false,
})

const contactValues = (command: AddContactCommand) => ({
  tenantId: command.tenantId,
  partyId: command.partyId,
  name: command.name,
  jobTitle: command.jobTitle ?? null,
  email: command.email ?? null,
  phone: command.phone ?? null,
})

const bankAccountValues = (command: AddBankAccountCommand) => ({
  tenantId: command.tenantId,
  partyId: command.partyId,
  bankName: command.bankName,
  accountNumber: command.accountNumber,
  accountHolder: command.accountHolder,
  currency: command.currency,
})

const makePostgresContactBookStore = Effect.gen(function* () {
  const database = yield* Database

  const partyMissing =
    (tenantId: string, partyId: string, constraint: string) => (error: DatabaseFailure) =>
      isDatabaseConstraint(error, constraint, "23503")
        ? new PartyNotFound({ tenantId, partyId })
        : error

  return {
    addAddress: (command) =>
      database
        .transaction(async (tx) => {
          if (command.primary === true) {
            await tx
              .update(partyAddresses)
              .set({ primary: false, updatedAt: new Date() })
              .where(
                and(
                  eq(partyAddresses.tenantId, command.tenantId),
                  eq(partyAddresses.partyId, command.partyId),
                  eq(partyAddresses.purpose, command.purpose),
                  eq(partyAddresses.primary, true),
                ),
              )
          }

          const rows = await tx.insert(partyAddresses).values(addressValues(command)).returning()
          const row = rows[0]!

          return {
            id: row.id,
            ...addressValues(command),
          }
        }, "party.address.add")
        .pipe(
          Effect.mapError(
            partyMissing(command.tenantId, command.partyId, "party_addresses_party_fkey"),
          ),
        ),
    addContact: (command) =>
      database
        .query(
          (db) =>
            db
              .insert(partyContacts)
              .values(contactValues(command))
              .returning({ id: partyContacts.id }),
          "party.contact.add",
        )
        .pipe(
          Effect.map((rows) => ({ id: rows[0]!.id, ...contactValues(command) })),
          Effect.mapError(
            partyMissing(command.tenantId, command.partyId, "party_contacts_party_fkey"),
          ),
        ),
    addBankAccount: (command) =>
      database
        .query(
          (db) =>
            db
              .insert(partyBankAccounts)
              .values(bankAccountValues(command))
              .returning({ id: partyBankAccounts.id }),
          "party.bank_account.add",
        )
        .pipe(
          Effect.map((rows) => ({ id: rows[0]!.id, ...bankAccountValues(command) })),
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "party_bank_accounts_party_bank_number_key")
              ? new PartyBankAccountAlreadyExists({
                  tenantId: command.tenantId,
                  partyId: command.partyId,
                  bankName: command.bankName,
                  accountNumber: command.accountNumber,
                })
              : partyMissing(
                  command.tenantId,
                  command.partyId,
                  "party_bank_accounts_party_fkey",
                )(error),
          ),
        ),
    getContactBook: (tenantId, partyId) =>
      database.transaction(async (tx) => {
        const scope = <
          T extends typeof partyAddresses | typeof partyContacts | typeof partyBankAccounts,
        >(
          table: T,
        ) => and(eq(table.tenantId, tenantId), eq(table.partyId, partyId))

        const addresses = await tx
          .select()
          .from(partyAddresses)
          .where(scope(partyAddresses))
          .orderBy(asc(partyAddresses.purpose), asc(partyAddresses.id))

        const contacts = await tx
          .select()
          .from(partyContacts)
          .where(scope(partyContacts))
          .orderBy(asc(partyContacts.id))

        const bankAccounts = await tx
          .select()
          .from(partyBankAccounts)
          .where(scope(partyBankAccounts))
          .orderBy(asc(partyBankAccounts.id))

        return {
          partyId,
          addresses: addresses.map(({ createdAt: _c, updatedAt: _u, ...row }) => row),
          contacts: contacts.map(({ createdAt: _c, updatedAt: _u, ...row }) => row),
          bankAccounts: bankAccounts.map(({ createdAt: _c, updatedAt: _u, ...row }) => row),
        }
      }, "party.contact_book.read"),
  } satisfies ContactBookStore
})

/** Deterministic store; `knownParty` decides which party ids exist, like the foreign key. */
const makeMemoryContactBookStore = (knownParty: (tenantId: string, partyId: string) => boolean) => {
  const addresses: PartyAddress[] = []
  const contacts: PartyContact[] = []
  const bankAccounts: PartyBankAccount[] = []

  const requireParty = (tenantId: string, partyId: string) =>
    knownParty(tenantId, partyId)
      ? Effect.void
      : Effect.fail(new PartyNotFound({ tenantId, partyId }))

  return {
    addAddress: (command) =>
      Effect.map(requireParty(command.tenantId, command.partyId), () => {
        if (command.primary === true) {
          for (const [index, address] of addresses.entries()) {
            if (
              address.tenantId === command.tenantId &&
              address.partyId === command.partyId &&
              address.purpose === command.purpose
            ) {
              addresses[index] = { ...address, primary: false }
            }
          }
        }

        const address = { id: uuidv7(), ...addressValues(command) }
        addresses.push(address)

        return address
      }),
    addContact: (command) =>
      Effect.map(requireParty(command.tenantId, command.partyId), () => {
        const contact = { id: uuidv7(), ...contactValues(command) }
        contacts.push(contact)

        return contact
      }),
    addBankAccount: (command) =>
      Effect.andThen(requireParty(command.tenantId, command.partyId), () => {
        const duplicate = bankAccounts.some(
          (account) =>
            account.tenantId === command.tenantId &&
            account.partyId === command.partyId &&
            account.bankName === command.bankName &&
            account.accountNumber === command.accountNumber,
        )

        if (duplicate) {
          return Effect.fail(
            new PartyBankAccountAlreadyExists({
              tenantId: command.tenantId,
              partyId: command.partyId,
              bankName: command.bankName,
              accountNumber: command.accountNumber,
            }),
          )
        }

        const account = { id: uuidv7(), ...bankAccountValues(command) }
        bankAccounts.push(account)

        return Effect.succeed(account)
      }),
    getContactBook: (tenantId, partyId) =>
      Effect.sync(() => {
        const owned = <T extends { tenantId: string; partyId: string }>(rows: T[]) =>
          rows.filter((row) => row.tenantId === tenantId && row.partyId === partyId)

        return {
          partyId,
          addresses: owned(addresses).toSorted((left, right) =>
            left.purpose.localeCompare(right.purpose),
          ),
          contacts: owned(contacts),
          bankAccounts: owned(bankAccounts),
        }
      }),
  } satisfies ContactBookStore
}

const makeContactServiceFromStore = <R>(storeEffect: Effect.Effect<ContactBookStore, never, R>) =>
  Effect.gen(function* () {
    const store = yield* storeEffect
    const authorization = yield* AuthorizationService

    const command = <
      A extends { principal: Schema.Schema.Type<typeof Principal>; tenantId: string },
    >(
      schema: Schema.Codec<A, unknown>,
      capability: CapabilityType,
    ) =>
      Effect.fn(function* (input: Schema.Codec.Encoded<typeof schema>) {
        const decoded = yield* Schema.decodeUnknownEffect(schema)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability,
        })
        const { principal: _principal, ...rest } = decoded

        return rest
      })

    const addAddress = command(AddPartyAddressInput, PartyCapabilities.partyAddressAdd)
    const addContact = command(AddPartyContactInput, PartyCapabilities.partyContactAdd)
    const addBankAccount = command(AddPartyBankAccountInput, PartyCapabilities.partyBankAccountAdd)
    const read = command(GetPartyContactBookInput, PartyCapabilities.partyRead)

    return {
      addAddress: Effect.fn("PartyContactService.addAddress")(function* (
        input: Schema.Codec.Encoded<typeof AddPartyAddressInput>,
      ) {
        return yield* store.addAddress(yield* addAddress(input))
      }),
      addContact: Effect.fn("PartyContactService.addContact")(function* (
        input: Schema.Codec.Encoded<typeof AddPartyContactInput>,
      ) {
        return yield* store.addContact(yield* addContact(input))
      }),
      addBankAccount: Effect.fn("PartyContactService.addBankAccount")(function* (
        input: Schema.Codec.Encoded<typeof AddPartyBankAccountInput>,
      ) {
        return yield* store.addBankAccount(yield* addBankAccount(input))
      }),
      getContactBook: Effect.fn("PartyContactService.getContactBook")(function* (
        input: Schema.Codec.Encoded<typeof GetPartyContactBookInput>,
      ) {
        const decoded = yield* read(input)

        return yield* store.getContactBook(decoded.tenantId, decoded.partyId)
      }),
    } satisfies PartyContactService
  })

export const PartyContactsLive = Layer.effect(
  PartyContactService,
  makeContactServiceFromStore(makePostgresContactBookStore),
)

export const makePartyContactsTestLayer = (
  knownParty: (tenantId: string, partyId: string) => boolean = () => true,
) =>
  Layer.effect(
    PartyContactService,
    makeContactServiceFromStore(Effect.sync(() => makeMemoryContactBookStore(knownParty))),
  )
