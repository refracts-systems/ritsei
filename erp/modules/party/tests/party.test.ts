import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  AuthorizationDenied,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import type { EventEnvelopeShape } from "../../../../framework/modules/messaging/mod.ts"
import {
  AssignPartyRoleInput,
  AttachExternalIdentifierInput,
  Branch,
  BranchAlreadyExists,
  CreateBranchInput,
  CreateLegalEntityInput,
  CreatePartyInput,
  CreatePartyRelationshipInput,
  CreatePartyRepresentationInput,
  ExternalIdentifier,
  ExternalIdentifierAlreadyAssigned,
  GetPartyRelationshipInput,
  LegalEntity,
  LegalEntityAlreadyExists,
  LegalEntityNotFound,
  makePartyTestLayer,
  OrganizationRequired,
  Party,
  PartyCapabilities,
  PartyCreatedEvent,
  PartyEventPublisher,
  PartyRelationship,
  PartyRelationshipAlreadyExists,
  PartyRelationshipNotFound,
  PartyRelationshipRoleNotAssigned,
  PartyRepresentation,
  PartyRepresentationAlreadyExists,
  PartyRepresentationNotFound,
  PartyRepresentationUserAccountNotFound,
  PartyRoleAlreadyAssigned,
  PartyService,
  SetPartyRepresentationActiveInput,
} from "../mod.ts"
import { makePartyMemoryStore } from "../src/memory.ts"
import { makePartyServiceFromStore } from "../src/service.ts"

const principal = { userAccountId: "party-admin", sessionId: "session" }
const tenantId = "00000000-0000-4000-8000-000000000001"
const deniedTenantId = "00000000-0000-4000-8000-000000000002"
const capabilities = [
  PartyCapabilities.partyCreate,
  PartyCapabilities.legalEntityCreate,
  PartyCapabilities.branchCreate,
  PartyCapabilities.partyRoleAssign,
  PartyCapabilities.partyRelationshipCreate,
  PartyCapabilities.partyRelationshipRead,
  PartyCapabilities.partyIdentifierAttach,
  PartyCapabilities.partyRepresentationCreate,
  PartyCapabilities.partyRepresentationActivate,
  PartyCapabilities.partyRepresentationDeactivate,
] as const

const authorizationLayer = makeAuthorizationTestLayer(
  capabilities.map((capability) => ({
    userAccountId: principal.userAccountId,
    tenantId,
    capability,
  })),
)

const withParty = <A, E>(program: Effect.Effect<A, E, PartyService>) =>
  Effect.provide(program, makePartyTestLayer().pipe(Layer.provide(authorizationLayer)))

describe("party contract", () => {
  it.effect("authorizes party creation and publishes its owner event", () =>
    Effect.gen(function* () {
      const published: EventEnvelopeShape[] = []
      const service = yield* Effect.provide(
        makePartyServiceFromStore(Effect.succeed(makePartyMemoryStore())),
        Layer.mergeAll(
          authorizationLayer,
          Layer.succeed(PartyEventPublisher, {
            append: (input) => {
              published.push(input as EventEnvelopeShape)
              return Effect.succeed(input as EventEnvelopeShape)
            },
          }),
        ),
      )
      const invalidTenant = yield* Effect.flip(
        Schema.decodeUnknownEffect(CreatePartyInput)({
          principal,
          tenantId: "not-a-uuid",
          kind: "organization",
          name: "Invalid Tenant",
        }),
      )
      assert.strictEqual(invalidTenant._tag, "SchemaError")
      const invalidName = yield* Effect.flip(
        Schema.decodeUnknownEffect(CreatePartyInput)({
          principal,
          tenantId,
          kind: "organization",
          name: "   ",
        }),
      )
      assert.strictEqual(invalidName._tag, "SchemaError")
      const party = yield* service.create({
        principal,
        tenantId,
        kind: "organization",
        name: " ACME Indonesia ",
      })

      assert.match(
        party.id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
      assert.strictEqual(party.name, "ACME Indonesia")
      assert.strictEqual(published.length, 1)
      assert.strictEqual(published[0].eventType, PartyCreatedEvent.id)
      assert.strictEqual(published[0].tenantId, tenantId)
      assert.strictEqual(published[0].aggregateId, party.id)
      assert.deepStrictEqual(published[0].payload, {
        partyId: party.id,
        kind: party.kind,
      })

      yield* Schema.decodeUnknownEffect(Party)(party)
      const denied = yield* Effect.flip(
        service.create({
          principal,
          tenantId: deniedTenantId,
          kind: "organization",
          name: "Denied Organization",
        }),
      )
      assert.instanceOf(denied, AuthorizationDenied)
      assert.strictEqual(published.length, 1)
    }),
  )

  it.effect("creates a party with roles and a scoped external identifier", () =>
    withParty(
      Effect.gen(function* () {
        const service = yield* PartyService
        const party = yield* service.create({
          principal,
          tenantId,
          kind: "organization",
          name: " ACME Indonesia ",
        })
        assert.strictEqual(
          (yield* Effect.flip(
            Schema.decodeUnknownEffect(Party)({ ...party, name: " ACME Indonesia " }),
          ))._tag,
          "SchemaError",
        )
        const invalidRole = yield* Effect.flip(
          Schema.decodeUnknownEffect(AssignPartyRoleInput)({
            principal,
            tenantId,
            partyId: "not-a-uuid",
            role: "customer",
          }),
        )
        assert.strictEqual(invalidRole._tag, "SchemaError")
        yield* service.assignRole({ principal, tenantId, partyId: party.id, role: "customer" })
        const invalidIdentifier = yield* Effect.flip(
          Schema.decodeUnknownEffect(AttachExternalIdentifierInput)({
            principal,
            tenantId,
            partyId: "not-a-uuid",
            provider: "gs1",
            scheme: "gln",
            scope: "global",
            value: "1234567890123",
          }),
        )
        assert.strictEqual(invalidIdentifier._tag, "SchemaError")
        const invalidIdentifierMetadata = yield* Effect.flip(
          Schema.decodeUnknownEffect(AttachExternalIdentifierInput)({
            principal,
            tenantId,
            partyId: party.id,
            provider: " ",
            scheme: "GLN",
            scope: "global",
            value: "1234567890123",
          }),
        )
        assert.strictEqual(invalidIdentifierMetadata._tag, "SchemaError")
        const identifier = yield* service.attachIdentifier({
          principal,
          tenantId,
          partyId: party.id,
          provider: "gs1",
          scheme: "gln",
          scope: "global",
          value: "1234567890123",
        })
        yield* Schema.decodeUnknownEffect(ExternalIdentifier)(identifier)
        for (const invalid of [
          { provider: " gs1 " },
          { scheme: "gln" },
          { scope: " global " },
          { value: " 1234567890123 " },
        ]) {
          assert.strictEqual(
            (yield* Effect.flip(
              Schema.decodeUnknownEffect(ExternalIdentifier)({ ...identifier, ...invalid }),
            ))._tag,
            "SchemaError",
          )
        }
        assert.strictEqual(
          (yield* Effect.flip(
            Schema.decodeUnknownEffect(ExternalIdentifier)({ ...identifier, value: " " }),
          ))._tag,
          "SchemaError",
        )
        const invalidLegalEntity = yield* Effect.flip(
          Schema.decodeUnknownEffect(CreateLegalEntityInput)({
            principal,
            tenantId,
            organizationId: "not-a-uuid",
          }),
        )
        assert.strictEqual(invalidLegalEntity._tag, "SchemaError")
        const legalEntity = yield* service.createLegalEntity({
          principal,
          tenantId,
          organizationId: party.id,
        })
        yield* Schema.decodeUnknownEffect(LegalEntity)(legalEntity)
        const invalidBranchName = yield* Effect.flip(
          Schema.decodeUnknownEffect(CreateBranchInput)({
            principal,
            tenantId,
            legalEntityId: legalEntity.id,
            name: "   ",
          }),
        )
        assert.strictEqual(invalidBranchName._tag, "SchemaError")
        const invalidBranchTimezone = yield* Effect.flip(
          Schema.decodeUnknownEffect(CreateBranchInput)({
            principal,
            tenantId,
            legalEntityId: legalEntity.id,
            name: "Jakarta",
            timezone: "   ",
          }),
        )
        assert.strictEqual(invalidBranchTimezone._tag, "SchemaError")
        const invalidBranchLegalEntity = yield* Effect.flip(
          Schema.decodeUnknownEffect(CreateBranchInput)({
            principal,
            tenantId,
            legalEntityId: "not-a-uuid",
            name: "Jakarta",
          }),
        )
        assert.strictEqual(invalidBranchLegalEntity._tag, "SchemaError")
        const branch = yield* service.createBranch({
          principal,
          tenantId,
          legalEntityId: legalEntity.id,
          name: " Jakarta ",
          timezone: " Asia/Jakarta ",
          localTaxRegistration: " TAX-JKT-001 ",
          dedicatedJournalCode: "JKT-OPS",
        })
        yield* Schema.decodeUnknownEffect(Branch)(branch)
        for (const invalid of [
          { name: " Jakarta " },
          { timezone: " Asia/Jakarta " },
          { localTaxRegistration: " TAX-JKT-001 " },
          { dedicatedJournalCode: " JKT-OPS " },
        ]) {
          assert.strictEqual(
            (yield* Effect.flip(Schema.decodeUnknownEffect(Branch)({ ...branch, ...invalid })))
              ._tag,
            "SchemaError",
          )
        }
        assert.strictEqual(
          (yield* Effect.flip(
            Schema.decodeUnknownEffect(Branch)({ ...branch, localTaxRegistration: " " }),
          ))._tag,
          "SchemaError",
        )
        assert.strictEqual(
          (yield* Effect.flip(
            Schema.decodeUnknownEffect(Branch)({ ...branch, dedicatedJournalCode: " " }),
          ))._tag,
          "SchemaError",
        )
        const invalidRelationship = yield* Effect.flip(
          Schema.decodeUnknownEffect(CreatePartyRelationshipInput)({
            principal,
            tenantId,
            partyId: "not-a-uuid",
            legalEntityId: legalEntity.id,
            kind: "customer",
          }),
        )
        assert.strictEqual(invalidRelationship._tag, "SchemaError")
        const relationship = yield* service.createRelationship({
          principal,
          tenantId,
          partyId: party.id,
          legalEntityId: legalEntity.id,
          kind: "customer",
        })
        yield* Schema.decodeUnknownEffect(PartyRelationship)(relationship)

        assert.strictEqual(party.name, "ACME Indonesia")
        assert.strictEqual(identifier.scheme, "GLN")
        assert.strictEqual(identifier.partyId, party.id)
        assert.strictEqual(legalEntity.organizationId, party.id)
        assert.strictEqual(branch.name, "Jakarta")
        assert.strictEqual(branch.timezone, "Asia/Jakarta")
        assert.strictEqual(branch.localTaxRegistration, "TAX-JKT-001")
        assert.strictEqual(branch.dedicatedJournalCode, "JKT-OPS")
        assert.strictEqual(relationship.kind, "customer")
        assert.strictEqual(relationship.active, true)
      }),
    ),
  )

  it.effect("creates and deactivates an identity-party representation", () => {
    const authorization = makeAuthorizationTestLayer([
      {
        userAccountId: principal.userAccountId,
        tenantId,
        capability: PartyCapabilities.partyCreate,
      },
      {
        userAccountId: principal.userAccountId,
        tenantId,
        capability: PartyCapabilities.partyRepresentationCreate,
      },
      {
        userAccountId: principal.userAccountId,
        tenantId,
        capability: PartyCapabilities.partyRepresentationActivate,
      },
      {
        userAccountId: principal.userAccountId,
        tenantId,
        capability: PartyCapabilities.partyRepresentationDeactivate,
      },
    ])
    return Effect.provide(
      Effect.gen(function* () {
        const service = yield* PartyService
        const party = yield* service.create({
          principal,
          tenantId,
          kind: "organization",
          name: "Represented Organization",
        })
        const input = {
          principal,
          tenantId,
          userAccountId: "00000000-0000-4000-8000-000000000010",
          partyId: party.id,
          kind: "representative",
        }
        const invalidRepresentation = yield* Effect.flip(
          Schema.decodeUnknownEffect(CreatePartyRepresentationInput)({
            ...input,
            userAccountId: "not-a-uuid",
          }),
        )
        assert.strictEqual(invalidRepresentation._tag, "SchemaError")
        const representation = yield* service.createPartyRepresentation(input)
        yield* Schema.decodeUnknownEffect(PartyRepresentation)(representation)
        assert.strictEqual(
          (yield* Effect.flip(
            Schema.decodeUnknownEffect(PartyRepresentation)({
              ...representation,
              kind: " representative ",
            }),
          ))._tag,
          "SchemaError",
        )
        assert.strictEqual(representation.active, true)
        assert.strictEqual(representation.kind, "representative")
        assert.instanceOf(
          yield* Effect.flip(service.createPartyRepresentation(input)),
          PartyRepresentationAlreadyExists,
        )
        const invalidRepresentationToggle = yield* Effect.flip(
          Schema.decodeUnknownEffect(SetPartyRepresentationActiveInput)({
            principal,
            tenantId,
            representationId: "not-a-uuid",
            active: false,
          }),
        )
        assert.strictEqual(invalidRepresentationToggle._tag, "SchemaError")
        const deactivated = yield* service.setPartyRepresentationActive({
          principal,
          tenantId,
          representationId: representation.id,
          active: false,
        })
        assert.strictEqual(deactivated.active, false)
        assert.instanceOf(
          yield* Effect.flip(
            service.setPartyRepresentationActive({
              principal,
              tenantId,
              representationId: "00000000-0000-4000-8000-000000000012",
              active: true,
            }),
          ),
          PartyRepresentationNotFound,
        )
        assert.instanceOf(
          yield* Effect.flip(
            service.createPartyRepresentation({
              ...input,
              userAccountId: "00000000-0000-4000-8000-000000000011",
            }),
          ),
          PartyRepresentationUserAccountNotFound,
        )
      }),
      makePartyTestLayer(new Set(["00000000-0000-4000-8000-000000000010"])).pipe(
        Layer.provide(authorization),
      ),
    )
  })

  it.effect("rejects duplicate roles and identifiers in their declared scope", () =>
    withParty(
      Effect.gen(function* () {
        const service = yield* PartyService
        const first = yield* service.create({
          principal,
          tenantId,
          kind: "organization",
          name: "First",
        })
        const second = yield* service.create({
          principal,
          tenantId,
          kind: "organization",
          name: "Second",
        })
        const role = { principal, tenantId, partyId: first.id, role: "supplier" as const }
        yield* service.assignRole(role)
        assert.instanceOf(yield* Effect.flip(service.assignRole(role)), PartyRoleAlreadyAssigned)

        const identifier = {
          principal,
          tenantId,
          partyId: first.id,
          provider: "gleif",
          scheme: "LEI",
          scope: "global",
          value: "5493001KJTIIGC8Y1R12",
        }
        yield* service.attachIdentifier(identifier)
        assert.instanceOf(
          yield* Effect.flip(service.attachIdentifier({ ...identifier, partyId: second.id })),
          ExternalIdentifierAlreadyAssigned,
        )

        const legalEntity = yield* service.createLegalEntity({
          principal,
          tenantId,
          organizationId: first.id,
        })
        const relationship = {
          principal,
          tenantId,
          partyId: first.id,
          legalEntityId: legalEntity.id,
          kind: "supplier" as const,
        }
        yield* service.createRelationship(relationship)
        assert.instanceOf(
          yield* Effect.flip(service.createRelationship(relationship)),
          PartyRelationshipAlreadyExists,
        )
        assert.instanceOf(
          yield* Effect.flip(
            service.createLegalEntity({
              principal,
              tenantId,
              organizationId: first.id,
            }),
          ),
          LegalEntityAlreadyExists,
        )
        const branch = {
          principal,
          tenantId,
          legalEntityId: legalEntity.id,
          name: "Jakarta",
        }
        yield* service.createBranch(branch)
        assert.instanceOf(yield* Effect.flip(service.createBranch(branch)), BranchAlreadyExists)
      }),
    ),
  )

  it.effect("scopes external identifiers by provider and legal entity", () =>
    withParty(
      Effect.gen(function* () {
        const service = yield* PartyService
        const first = yield* service.create({
          principal,
          tenantId,
          kind: "organization",
          name: "First Identifier Owner",
        })
        const second = yield* service.create({
          principal,
          tenantId,
          kind: "organization",
          name: "Second Identifier Owner",
        })
        const firstLegalEntity = yield* service.createLegalEntity({
          principal,
          tenantId,
          organizationId: first.id,
        })
        const secondLegalEntity = yield* service.createLegalEntity({
          principal,
          tenantId,
          organizationId: second.id,
        })
        const identifier = {
          principal,
          tenantId,
          provider: "registry",
          scheme: "account",
          scope: "local",
          value: "42",
        }
        const firstIdentifier = yield* service.attachIdentifier({
          ...identifier,
          partyId: first.id,
          legalEntityId: firstLegalEntity.id,
        })
        const secondIdentifier = yield* service.attachIdentifier({
          ...identifier,
          partyId: second.id,
          legalEntityId: secondLegalEntity.id,
        })

        assert.strictEqual(firstIdentifier.provider, "REGISTRY")
        assert.strictEqual(firstIdentifier.legalEntityId, firstLegalEntity.id)
        assert.strictEqual(secondIdentifier.legalEntityId, secondLegalEntity.id)
        assert.instanceOf(
          yield* Effect.flip(
            service.attachIdentifier({
              ...identifier,
              partyId: first.id,
              legalEntityId: "00000000-0000-4000-8000-000000000015",
            }),
          ),
          LegalEntityNotFound,
        )
      }),
    ),
  )

  it.effect("reads a tenant-scoped relationship and reports missing relationships", () =>
    withParty(
      Effect.gen(function* () {
        const service = yield* PartyService
        const party = yield* service.create({
          principal,
          tenantId,
          kind: "organization",
          name: "Readable Supplier",
        })
        yield* service.assignRole({ principal, tenantId, partyId: party.id, role: "supplier" })
        const legalEntity = yield* service.createLegalEntity({
          principal,
          tenantId,
          organizationId: party.id,
        })
        const relationship = yield* service.createRelationship({
          principal,
          tenantId,
          partyId: party.id,
          legalEntityId: legalEntity.id,
          kind: "supplier",
        })

        const invalidRelationshipRead = yield* Effect.flip(
          Schema.decodeUnknownEffect(GetPartyRelationshipInput)({
            principal,
            tenantId,
            relationshipId: "not-a-uuid",
          }),
        )
        assert.strictEqual(invalidRelationshipRead._tag, "SchemaError")
        assert.deepStrictEqual(
          yield* service.getRelationship({ principal, tenantId, relationshipId: relationship.id }),
          relationship,
        )
        assert.instanceOf(
          yield* Effect.flip(
            service.getRelationship({
              principal,
              tenantId,
              relationshipId: "00000000-0000-4000-8000-000000000013",
            }),
          ),
          PartyRelationshipNotFound,
        )
      }),
    ),
  )

  it.effect("returns bounded active related-party paths", () =>
    withParty(
      Effect.gen(function* () {
        const service = yield* PartyService
        const source = yield* service.create({
          principal,
          tenantId,
          kind: "person",
          name: "Source Party",
        })
        const target = yield* service.create({
          principal,
          tenantId,
          kind: "organization",
          name: "Target Organization",
        })
        const legalEntity = yield* service.createLegalEntity({
          principal,
          tenantId,
          organizationId: target.id,
        })
        yield* service.assignRole({ principal, tenantId, partyId: source.id, role: "supplier" })
        const relationship = yield* service.createRelationship({
          principal,
          tenantId,
          partyId: source.id,
          legalEntityId: legalEntity.id,
          kind: "supplier",
        })

        assert.deepStrictEqual(
          yield* service.findRelatedPartyPaths({
            principal,
            tenantId,
            sourcePartyId: source.id,
            limit: 1,
          }),
          [
            {
              tenantId,
              sourcePartyId: source.id,
              targetPartyId: target.id,
              legalEntityId: legalEntity.id,
              relationshipId: relationship.id,
              relationshipKind: "supplier",
              depth: 2,
            },
          ],
        )
      }),
    ),
  )

  it.effect("filters reflexive related-party paths", () =>
    withParty(
      Effect.gen(function* () {
        const service = yield* PartyService
        const organization = yield* service.create({
          principal,
          tenantId,
          kind: "organization",
          name: "Self Organization",
        })
        const legalEntity = yield* service.createLegalEntity({
          principal,
          tenantId,
          organizationId: organization.id,
        })
        yield* service.assignRole({
          principal,
          tenantId,
          partyId: organization.id,
          role: "customer",
        })
        yield* service.createRelationship({
          principal,
          tenantId,
          partyId: organization.id,
          legalEntityId: legalEntity.id,
          kind: "customer",
        })

        assert.deepStrictEqual(
          yield* service.findRelatedPartyPaths({
            principal,
            tenantId,
            sourcePartyId: organization.id,
            limit: 10,
          }),
          [],
        )
      }),
    ),
  )

  it.effect("denies relationship reads without their capability", () => {
    const authorization = makeAuthorizationTestLayer(
      capabilities
        .values()
        .filter((capability) => capability !== PartyCapabilities.partyRelationshipRead)
        .map((capability) => ({
          userAccountId: principal.userAccountId,
          tenantId,
          capability,
        }))
        .toArray(),
    )
    return Effect.provide(
      Effect.gen(function* () {
        const service = yield* PartyService
        assert.instanceOf(
          yield* Effect.flip(
            service.getRelationship({
              principal,
              tenantId,
              relationshipId: "00000000-0000-4000-8000-000000000014",
            }),
          ),
          AuthorizationDenied,
        )
      }),
      makePartyTestLayer().pipe(Layer.provide(authorization)),
    )
  })

  it.effect("requires an assigned role for a legal entity relationship", () =>
    withParty(
      Effect.gen(function* () {
        const service = yield* PartyService
        const party = yield* service.create({
          principal,
          tenantId,
          kind: "organization",
          name: "Unclassified Supplier",
        })
        const legalEntity = yield* service.createLegalEntity({
          principal,
          tenantId,
          organizationId: party.id,
        })
        const error = yield* Effect.flip(
          service.createRelationship({
            principal,
            tenantId,
            partyId: party.id,
            legalEntityId: legalEntity.id,
            kind: "supplier",
          }),
        )
        assert.instanceOf(error, PartyRelationshipRoleNotAssigned)
      }),
    ),
  )

  it.effect("requires an organization party and an existing legal entity", () =>
    withParty(
      Effect.gen(function* () {
        const service = yield* PartyService
        const person = yield* service.create({
          principal,
          tenantId,
          kind: "person",
          name: "Sari",
        })
        assert.instanceOf(
          yield* Effect.flip(
            service.createLegalEntity({
              principal,
              tenantId,
              organizationId: person.id,
            }),
          ),
          OrganizationRequired,
        )
        assert.instanceOf(
          yield* Effect.flip(
            service.createBranch({
              principal,
              tenantId,
              legalEntityId: "00000000-0000-4000-8000-000000000099",
              name: "Jakarta",
            }),
          ),
          LegalEntityNotFound,
        )
      }),
    ),
  )

  it.effect("denies legal entity creation without its capability", () => {
    const authorization = makeAuthorizationTestLayer([
      {
        userAccountId: principal.userAccountId,
        tenantId,
        capability: PartyCapabilities.partyCreate,
      },
    ])
    return Effect.provide(
      Effect.gen(function* () {
        const service = yield* PartyService
        const party = yield* service.create({
          principal,
          tenantId,
          kind: "organization",
          name: "No Legal Entity Capability",
        })
        assert.instanceOf(
          yield* Effect.flip(
            service.createLegalEntity({
              principal,
              tenantId,
              organizationId: party.id,
            }),
          ),
          AuthorizationDenied,
        )
      }),
      makePartyTestLayer().pipe(Layer.provide(authorization)),
    )
  })

  it.effect("denies relationship creation without its capability", () => {
    const authorization = makeAuthorizationTestLayer([
      {
        userAccountId: principal.userAccountId,
        tenantId,
        capability: PartyCapabilities.partyCreate,
      },
      {
        userAccountId: principal.userAccountId,
        tenantId,
        capability: PartyCapabilities.partyRoleAssign,
      },
      {
        userAccountId: principal.userAccountId,
        tenantId,
        capability: PartyCapabilities.legalEntityCreate,
      },
    ])
    return Effect.provide(
      Effect.gen(function* () {
        const service = yield* PartyService
        const party = yield* service.create({
          principal,
          tenantId,
          kind: "organization",
          name: "No Relationship Capability",
        })
        yield* service.assignRole({
          principal,
          tenantId,
          partyId: party.id,
          role: "supplier",
        })
        const legalEntity = yield* service.createLegalEntity({
          principal,
          tenantId,
          organizationId: party.id,
        })
        assert.instanceOf(
          yield* Effect.flip(
            service.createRelationship({
              principal,
              tenantId,
              partyId: party.id,
              legalEntityId: legalEntity.id,
              kind: "supplier",
            }),
          ),
          AuthorizationDenied,
        )
      }),
      makePartyTestLayer().pipe(Layer.provide(authorization)),
    )
  })
})
