// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as Schema from "effect/Schema"

import {
  ApiErrors as errors,
  BaseApiErrorPolicy,
  BearerAuth,
  CurrentPrincipal,
  NonEmptyString,
  ShortString,
  TenantHeaders as tenantHeaders,
  Uuid,
  makeApiErrorMapping,
  makeModuleApi,
} from "../../../framework/modules/http/mod.ts"
import {
  Branch,
  ExternalIdentifier,
  LegalEntity,
  Party,
  PartyDetail,
  PartyDirectoryEntry,
  PartyKind,
  PartyRelationship,
  PartyRelationshipKind,
  PartyRepresentation,
  PartyRepresentationKind,
  PartyRole,
  PartyService,
  RelatedPartyPath,
} from "./mod.ts"

const CreatedParty = Party.pipe(HttpApiSchema.status(201))
const CreatedLegalEntity = LegalEntity.pipe(HttpApiSchema.status(201))
const CreatedBranch = Branch.pipe(HttpApiSchema.status(201))
const CreatedExternalIdentifier = ExternalIdentifier.pipe(HttpApiSchema.status(201))
const CreatedPartyRelationship = PartyRelationship.pipe(HttpApiSchema.status(201))
const CreatedPartyRepresentation = PartyRepresentation.pipe(HttpApiSchema.status(201))

export const PartyHttpGroup = HttpApiGroup.make("Parties").add(
  HttpApiEndpoint.get("list", "/parties", {
    headers: tenantHeaders,
    query: {
      search: Schema.optionalKey(ShortString),
      kind: Schema.optionalKey(PartyKind),
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        ),
      ),
    },
    success: Schema.Array(PartyDirectoryEntry),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("get", "/parties/:id", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: PartyDetail,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("create", "/parties", {
    headers: tenantHeaders,
    payload: Schema.Struct({ kind: PartyKind, name: ShortString }),
    success: CreatedParty,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createLegalEntity", "/parties/:id/legal-entity", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: CreatedLegalEntity,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createBranch", "/legal-entities/:id/branches", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({
      name: ShortString,
      timezone: Schema.optionalKey(ShortString),
      localTaxRegistration: Schema.optionalKey(ShortString),
      dedicatedJournalCode: Schema.optionalKey(ShortString),
    }),
    success: CreatedBranch,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("assignRole", "/parties/:id/roles", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({ role: PartyRole }),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("attachIdentifier", "/parties/:id/identifiers", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({
      provider: ShortString,
      scheme: ShortString,
      scope: ShortString,
      legalEntityId: Schema.optionalKey(Uuid),
      value: NonEmptyString,
    }),
    success: CreatedExternalIdentifier,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createRelationship", "/parties/:id/relationships", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({
      legalEntityId: Uuid,
      kind: PartyRelationshipKind,
    }),
    success: CreatedPartyRelationship,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createRepresentation", "/parties/:id/representations", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({
      userAccountId: Uuid,
      kind: PartyRepresentationKind,
    }),
    success: CreatedPartyRepresentation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.patch("setRepresentationActive", "/party-representations/:id", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({ active: Schema.Boolean }),
    success: PartyRepresentation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("findRelatedPartyPaths", "/parties/:id/related-paths", {
    params: { id: Uuid },
    headers: tenantHeaders,
    query: {
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
        ),
      ),
    },
    success: Schema.Array(RelatedPartyPath),
    error: errors,
  }).middleware(BearerAuth),
)

const PartyHttpApi = makeModuleApi(PartyHttpGroup)

export const PartyHttpErrors = makeApiErrorMapping({
  ...BaseApiErrorPolicy,
  BranchAlreadyExists: "conflict",
  ExternalIdentifierAlreadyAssigned: "conflict",
  LegalEntityAlreadyExists: "conflict",
  LegalEntityNotFound: "not_found",
  OrganizationRequired: "conflict",
  PartyNotFound: "not_found",
  PartyRelationshipAlreadyExists: "conflict",
  PartyRelationshipRoleNotAssigned: "conflict",
  PartyRepresentationAlreadyExists: "conflict",
  PartyRepresentationNotFound: "not_found",
  PartyRepresentationUserAccountNotFound: "not_found",
  PartyRoleAlreadyAssigned: "conflict",
})
const coreApiEffect = PartyHttpErrors.apiEffect

export const PartyHttpHandlers = HttpApiBuilder.group(PartyHttpApi, "Parties", (handlers) =>
  Effect.gen(function* () {
    const party = yield* PartyService
    return handlers
      .handle(
        "list",
        Effect.fn("Http.Parties.list")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            party.list({
              principal,
              tenantId: headers["x-tenant-id"],
              ...query,
            }),
          )
        }),
      )
      .handle(
        "get",
        Effect.fn("Http.Parties.get")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            party.getDetail({
              principal,
              tenantId: headers["x-tenant-id"],
              partyId: params.id,
            }),
          )
        }),
      )
      .handle(
        "create",
        Effect.fn("Http.Parties.create")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            party.create({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
      .handle(
        "createLegalEntity",
        Effect.fn("Http.Parties.createLegalEntity")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            party.createLegalEntity({
              principal,
              tenantId: headers["x-tenant-id"],
              organizationId: params.id,
            }),
          )
        }),
      )
      .handle(
        "createBranch",
        Effect.fn("Http.Parties.createBranch")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            party.createBranch({
              principal,
              tenantId: headers["x-tenant-id"],
              legalEntityId: params.id,
              ...payload,
            }),
          )
        }),
      )
      .handle(
        "assignRole",
        Effect.fn("Http.Parties.assignRole")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            party.assignRole({
              principal,
              tenantId: headers["x-tenant-id"],
              partyId: params.id,
              role: payload.role,
            }),
          )
        }),
      )
      .handle(
        "attachIdentifier",
        Effect.fn("Http.Parties.attachIdentifier")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            party.attachIdentifier({
              principal,
              tenantId: headers["x-tenant-id"],
              partyId: params.id,
              ...payload,
            }),
          )
        }),
      )
      .handle(
        "createRelationship",
        Effect.fn("Http.Parties.createRelationship")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            party.createRelationship({
              principal,
              tenantId: headers["x-tenant-id"],
              partyId: params.id,
              ...payload,
            }),
          )
        }),
      )
      .handle(
        "createRepresentation",
        Effect.fn("Http.Parties.createRepresentation")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            party.createPartyRepresentation({
              principal,
              tenantId: headers["x-tenant-id"],
              partyId: params.id,
              ...payload,
            }),
          )
        }),
      )
      .handle(
        "setRepresentationActive",
        Effect.fn("Http.Parties.setRepresentationActive")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            party.setPartyRepresentationActive({
              principal,
              tenantId: headers["x-tenant-id"],
              representationId: params.id,
              active: payload.active,
            }),
          )
        }),
      )
      .handle(
        "findRelatedPartyPaths",
        Effect.fn("Http.Parties.findRelatedPartyPaths")(function* ({ headers, params, query }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            party.findRelatedPartyPaths({
              principal,
              tenantId: headers["x-tenant-id"],
              sourcePartyId: params.id,
              ...query,
            }),
          )
        }),
      )
  }),
)
