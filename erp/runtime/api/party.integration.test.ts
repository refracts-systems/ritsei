import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { Etag, HttpPlatform } from "effect/http"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import * as HttpApiTest from "effect/http-api/HttpApiTest"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import { makeAuthorizationTestLayer } from "../../../framework/modules/authorization/mod.ts"
import {
  makePartyContactsTestLayer,
  makePartyTestLayer,
  type OrgUnit,
  OrgUnitService,
  PartyCapabilities,
} from "../../modules/party/mod.ts"
import { BearerAuth, CurrentPrincipal, RitseiApi } from "./api.ts"
import { PartyHttpHandlers as PartyHandlers } from "../../modules/party/http.ts"

const tenantId = "018f0000-0000-7000-8000-000000000001"
const otherTenantId = "018f0000-0000-7000-8000-000000000002"
const userAccountId = "018f0000-0000-7000-8000-000000000003"
const principal = { userAccountId: "party-api-admin", sessionId: "party-api-session" }

const TestHttpServices = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

const unitId = "018f0000-0000-7000-8000-000000000010"
const legalEntityId = "018f0000-0000-7000-8000-000000000011"

/** A service that records what the routes pass in and answers with one fixed unit. */
type ScopedCall = {
  readonly principal: typeof principal
  readonly tenantId: string
  readonly unitId?: string
  readonly parentId?: string
}

const makeOrgUnitStub = () => {
  const calls: Array<{ readonly name: string; readonly input: ScopedCall }> = []

  const unit = (legalEntityIds: ReadonlyArray<string>): OrgUnit => ({
    id: unitId,
    tenantId,
    kind: "group",
    name: "Northwind Group",
    parentId: null,
    currency: "IDR",
    legalEntityIds,
  })

  const record = (name: string, input: ScopedCall, result: OrgUnit) =>
    Effect.sync(() => {
      calls.push({ name, input })

      return result
    })

  const service = OrgUnitService.of({
    create: (input) => record("create", input, unit([])),
    move: (input) => record("move", input, unit([])),
    assignLegalEntity: (input) => record("assign", input, unit([legalEntityId])),
    list: (input) => Effect.map(record("list", input, unit([])), (found) => [found]),
    resolve: () => Effect.die("not used by the routes"),
  })

  return { calls, layer: Layer.succeed(OrgUnitService, service) }
}

const capabilities = [
  PartyCapabilities.partyRead,
  PartyCapabilities.partyCreate,
  PartyCapabilities.legalEntityCreate,
  PartyCapabilities.branchCreate,
  PartyCapabilities.partyRoleAssign,
  PartyCapabilities.partyIdentifierAttach,
  PartyCapabilities.partyRelationshipCreate,
  PartyCapabilities.partyRelationshipRead,
  PartyCapabilities.partyRepresentationCreate,
  PartyCapabilities.partyRepresentationActivate,
  PartyCapabilities.partyRepresentationDeactivate,
] as const

it.layer(TestHttpServices)("Party API", (it) => {
  it.effect("serves the complete active tenant administration surface", () =>
    Effect.gen(function* () {
      const authorization = makeAuthorizationTestLayer(
        capabilities.map((capability) => ({
          userAccountId: principal.userAccountId,
          tenantId,
          capability,
        })),
      )

      const party = makePartyTestLayer(new Set([userAccountId])).pipe(Layer.provide(authorization))

      const bearer = Layer.succeed(BearerAuth, {
        bearer: (effect) => Effect.provideService(effect, CurrentPrincipal, principal),
      })

      const bearerClient = HttpApiMiddleware.layerClient(BearerAuth, ({ request, next }) =>
        next(HttpClientRequest.bearerToken(request, "test-token")),
      )

      const contacts = makePartyContactsTestLayer().pipe(Layer.provide(authorization))

      const orgUnitStub = makeOrgUnitStub()

      const handlers = PartyHandlers.pipe(
        Layer.provide(bearer),
        Layer.provide(party),
        Layer.provide(contacts),
        Layer.provide(orgUnitStub.layer),
      )

      const client = yield* HttpApiTest.groups(RitseiApi, ["Parties"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, bearerClient, bearer)),
      )

      const createdUnit = yield* client.Parties.createOrgUnit({
        headers: { "x-tenant-id": tenantId },
        payload: { kind: "group", name: "Northwind Group", currency: "IDR" },
      })

      const movedUnit = yield* client.Parties.moveOrgUnit({
        params: { id: createdUnit.id },
        headers: { "x-tenant-id": tenantId },
        payload: { parentId: unitId },
      })

      const assignedUnit = yield* client.Parties.assignLegalEntityToOrgUnit({
        params: { id: createdUnit.id },
        headers: { "x-tenant-id": tenantId },
        payload: { legalEntityId },
      })

      const listedUnits = yield* client.Parties.listOrgUnits({
        headers: { "x-tenant-id": tenantId },
      })

      assert.strictEqual(movedUnit.id, unitId)
      assert.deepStrictEqual(assignedUnit.legalEntityIds, [legalEntityId])
      assert.strictEqual(listedUnits.length, 1)

      assert.deepStrictEqual(
        orgUnitStub.calls.map((call) => call.name),
        ["create", "move", "assign", "list"],
      )

      assert.deepStrictEqual(orgUnitStub.calls[1], {
        name: "move",
        input: { principal, tenantId, unitId, parentId: unitId },
      })

      const organization = yield* client.Parties.create({
        headers: { "x-tenant-id": tenantId },
        payload: { kind: "organization", name: "Northwind Holdings" },
      })

      const person = yield* client.Parties.create({
        headers: { "x-tenant-id": tenantId },
        payload: { kind: "person", name: "Ada Lovelace" },
      })

      const legalEntity = yield* client.Parties.createLegalEntity({
        params: { id: organization.id },
        headers: { "x-tenant-id": tenantId },
      })

      const branch = yield* client.Parties.createBranch({
        params: { id: legalEntity.id },
        headers: { "x-tenant-id": tenantId },
        payload: {
          name: "London",
          timezone: "Europe/London",
          localTaxRegistration: "GB-001",
          dedicatedJournalCode: "LON",
        },
      })

      yield* client.Parties.assignRole({
        params: { id: person.id },
        headers: { "x-tenant-id": tenantId },
        payload: { role: "customer" },
      })

      const identifier = yield* client.Parties.attachIdentifier({
        params: { id: person.id },
        headers: { "x-tenant-id": tenantId },
        payload: {
          provider: "CRM",
          scheme: "CUSTOMER-ID",
          scope: "tenant",
          value: "C-001",
        },
      })

      const relationship = yield* client.Parties.createRelationship({
        params: { id: person.id },
        headers: { "x-tenant-id": tenantId },
        payload: { legalEntityId: legalEntity.id, kind: "customer" },
      })

      const representation = yield* client.Parties.createRepresentation({
        params: { id: person.id },
        headers: { "x-tenant-id": tenantId },
        payload: { userAccountId, kind: "self" },
      })

      const deactivated = yield* client.Parties.setRepresentationActive({
        params: { id: representation.id },
        headers: { "x-tenant-id": tenantId },
        payload: { active: false },
      })

      assert.isFalse(deactivated.active)

      const activated = yield* client.Parties.setRepresentationActive({
        params: { id: representation.id },
        headers: { "x-tenant-id": tenantId },
        payload: { active: true },
      })

      assert.isTrue(activated.active)

      const directory = yield* client.Parties.list({
        headers: { "x-tenant-id": tenantId },
        query: { search: "wind", kind: "organization", limit: 10 },
      })

      assert.deepStrictEqual(
        directory.map(({ party }) => party.id),
        [organization.id],
      )
      assert.strictEqual(directory[0]?.legalEntityId, legalEntity.id)

      const detail = yield* client.Parties.get({
        params: { id: person.id },
        headers: { "x-tenant-id": tenantId },
      })

      assert.deepStrictEqual(detail.roles, ["customer"])
      assert.deepStrictEqual(detail.identifiers, [identifier])
      assert.deepStrictEqual(detail.relationships, [relationship])
      assert.strictEqual(detail.representations[0]?.active, true)

      const organizationDetail = yield* client.Parties.get({
        params: { id: organization.id },
        headers: { "x-tenant-id": tenantId },
      })

      assert.deepStrictEqual(organizationDetail.legalEntity, legalEntity)
      assert.deepStrictEqual(organizationDetail.branches, [branch])

      const related = yield* client.Parties.findRelatedPartyPaths({
        params: { id: person.id },
        headers: { "x-tenant-id": tenantId },
        query: { limit: 10 },
      })

      assert.deepStrictEqual(
        related.map(({ targetPartyId }) => targetPartyId),
        [organization.id],
      )

      const denied = yield* Effect.flip(
        client.Parties.list({
          headers: { "x-tenant-id": otherTenantId },
          query: {},
        }),
      )

      assert.strictEqual(denied._tag, "ApiForbidden")
    }),
  )
})
