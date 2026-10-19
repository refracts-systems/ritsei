import * as Schema from "effect/Schema"
import type { DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { PartyRelationshipKind, PartyRepresentationKind, PartyRole } from "./contract.ts"

const Uuid = Schema.String.check(Schema.isUUID())

export class PartyNotFound extends Schema.TaggedError<PartyNotFound>()("PartyNotFound", {
  tenantId: Uuid,
  partyId: Uuid,
}) {}
export class PartyRoleAlreadyAssigned extends Schema.TaggedError<PartyRoleAlreadyAssigned>()(
  "PartyRoleAlreadyAssigned",
  {
    tenantId: Uuid,
    partyId: Uuid,
    role: Schema.Literals(["customer", "supplier", "employee", "partner"]),
  },
) {}
export class PartyRelationshipAlreadyExists extends Schema.TaggedError<PartyRelationshipAlreadyExists>()(
  "PartyRelationshipAlreadyExists",
  {
    tenantId: Uuid,
    partyId: Uuid,
    legalEntityId: Uuid,
    kind: Schema.Literals(["customer", "supplier", "employee", "partner"]),
  },
) {}
export class PartyRelationshipRoleNotAssigned extends Schema.TaggedError<PartyRelationshipRoleNotAssigned>()(
  "PartyRelationshipRoleNotAssigned",
  {
    tenantId: Uuid,
    partyId: Uuid,
    kind: Schema.Literals(["customer", "supplier", "employee", "partner"]),
  },
) {}
export class PartyRelationshipNotFound extends Schema.TaggedError<PartyRelationshipNotFound>()(
  "PartyRelationshipNotFound",
  { tenantId: Uuid, relationshipId: Uuid },
) {}
export class ExternalIdentifierAlreadyAssigned extends Schema.TaggedError<ExternalIdentifierAlreadyAssigned>()(
  "ExternalIdentifierAlreadyAssigned",
  {
    tenantId: Uuid,
    provider: Schema.String,
    scheme: Schema.String,
    scope: Schema.String,
    legalEntityId: Schema.NullOr(Uuid),
    value: Schema.String,
  },
) {}
export class OrganizationRequired extends Schema.TaggedError<OrganizationRequired>()(
  "OrganizationRequired",
  { tenantId: Uuid, partyId: Uuid },
) {}
export class LegalEntityAlreadyExists extends Schema.TaggedError<LegalEntityAlreadyExists>()(
  "LegalEntityAlreadyExists",
  { tenantId: Uuid, organizationId: Uuid },
) {}
export class LegalEntityNotFound extends Schema.TaggedError<LegalEntityNotFound>()(
  "LegalEntityNotFound",
  { tenantId: Uuid, legalEntityId: Uuid },
) {}
export class BranchAlreadyExists extends Schema.TaggedError<BranchAlreadyExists>()(
  "BranchAlreadyExists",
  { tenantId: Uuid, legalEntityId: Uuid, name: Schema.String },
) {}
export class PartyRepresentationUserAccountNotFound extends Schema.TaggedError<PartyRepresentationUserAccountNotFound>()(
  "PartyRepresentationUserAccountNotFound",
  { tenantId: Uuid, userAccountId: Uuid },
) {}
export class PartyRepresentationAlreadyExists extends Schema.TaggedError<PartyRepresentationAlreadyExists>()(
  "PartyRepresentationAlreadyExists",
  {
    tenantId: Uuid,
    userAccountId: Uuid,
    partyId: Uuid,
    kind: Schema.String,
  },
) {}
export class PartyRepresentationNotFound extends Schema.TaggedError<PartyRepresentationNotFound>()(
  "PartyRepresentationNotFound",
  { tenantId: Uuid, representationId: Uuid },
) {}

export type PartyFailure =
  | AuthorizationDenied
  | DatabaseFailure
  | Schema.SchemaError
  | PartyNotFound
  | PartyRoleAlreadyAssigned
  | PartyRelationshipAlreadyExists
  | PartyRelationshipRoleNotAssigned
  | PartyRelationshipNotFound
  | ExternalIdentifierAlreadyAssigned
  | OrganizationRequired
  | LegalEntityAlreadyExists
  | LegalEntityNotFound
  | BranchAlreadyExists
  | PartyRepresentationUserAccountNotFound
  | PartyRepresentationAlreadyExists
  | PartyRepresentationNotFound

export type { PartyRelationshipKind, PartyRepresentationKind, PartyRole }
