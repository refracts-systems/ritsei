import { and, asc, eq, sql } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { orgUnitMembers, orgUnits } from "../../../../db/schema/party.ts"
import {
  Database,
  type DatabaseFailure,
  isDatabaseConstraint,
  TrimmedText,
  Uuid,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import {
  AuthorizationService,
  type AuthorizationDenied,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { PartyCapabilities } from "./capabilities.ts"

const ScopedInput = { principal: Principal, tenantId: Uuid }

export const OrgUnitKind = Schema.Literals(["group", "business_unit"])

/** A node of the organization tree above legal entities (ADR-0130). */
export const OrgUnit = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  kind: OrgUnitKind,
  name: Schema.String,
  parentId: Schema.NullOr(Uuid),
  /** The currency of the root group this unit sits under. */
  currency: Schema.String,
  legalEntityIds: Schema.Array(Uuid),
})

export type OrgUnit = Schema.Schema.Type<typeof OrgUnit>

/** A root group carries the currency; any other unit sits under a parent and has none. */
export const CreateOrgUnitInput = Schema.Struct({
  ...ScopedInput,
  kind: OrgUnitKind,
  name: TrimmedText(120),
  parentId: Schema.optionalKey(Uuid),
  currency: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/))),
})

export const MoveOrgUnitInput = Schema.Struct({ ...ScopedInput, unitId: Uuid, parentId: Uuid })

export const AssignLegalEntityInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  unitId: Uuid,
})

export const ListOrgUnitsInput = Schema.Struct({ ...ScopedInput })

export const ResolveUnitInput = Schema.Struct({ ...ScopedInput, unitId: Uuid })

/** The legal entities at or under a unit, and the currency of its root group. */
export const ResolvedUnit = Schema.Struct({
  unitId: Uuid,
  currency: Schema.String,
  legalEntityIds: Schema.Array(Uuid),
})

export type ResolvedUnit = Schema.Schema.Type<typeof ResolvedUnit>

export class OrgUnitNotFound extends Schema.TaggedError<OrgUnitNotFound>()("OrgUnitNotFound", {
  tenantId: Uuid,
  unitId: Uuid,
}) {}

export class OrgUnitInvalid extends Schema.TaggedError<OrgUnitInvalid>()("OrgUnitInvalid", {
  tenantId: Uuid,
  reason: Schema.String,
}) {}

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export interface OrgUnitService {
  readonly create: (
    input: Schema.Codec.Encoded<typeof CreateOrgUnitInput>,
  ) => Effect.Effect<OrgUnit, OrgUnitNotFound | OrgUnitInvalid | CommonFailure>
  readonly move: (
    input: Schema.Codec.Encoded<typeof MoveOrgUnitInput>,
  ) => Effect.Effect<OrgUnit, OrgUnitNotFound | OrgUnitInvalid | CommonFailure>
  /** Puts a legal entity in a unit, taking it out of the one it was in. */
  readonly assignLegalEntity: (
    input: Schema.Codec.Encoded<typeof AssignLegalEntityInput>,
  ) => Effect.Effect<OrgUnit, OrgUnitNotFound | OrgUnitInvalid | CommonFailure>
  readonly list: (
    input: Schema.Codec.Encoded<typeof ListOrgUnitsInput>,
  ) => Effect.Effect<ReadonlyArray<OrgUnit>, CommonFailure>
  readonly resolve: (
    input: Schema.Codec.Encoded<typeof ResolveUnitInput>,
  ) => Effect.Effect<ResolvedUnit, OrgUnitNotFound | CommonFailure>
}

export const OrgUnitService = Context.Service<OrgUnitService>("RITSEI/OrgUnitService")

export const makeOrgUnitService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const authorized = scopedCommand(authorization)

  const view = (tenantId: string) =>
    Effect.gen(function* () {
      const units = yield* database.query(
        (db) =>
          db
            .select()
            .from(orgUnits)
            .where(eq(orgUnits.tenantId, tenantId))
            .orderBy(asc(orgUnits.path)),
        "party.org_unit.list",
      )

      const members = yield* database.query(
        (db) => db.select().from(orgUnitMembers).where(eq(orgUnitMembers.tenantId, tenantId)),
        "party.org_unit.members",
      )

      const byId = new Map(units.map((unit) => [unit.id, unit]))

      const currencyOf = (unit: (typeof units)[number]): string => {
        const root = unit.path.split(".")[0]

        const found = units.find(
          (candidate) => candidate.parentId === null && candidate.path === root,
        )

        return found?.currency ?? unit.currency ?? ""
      }

      return units.map((unit): OrgUnit => ({
        id: unit.id,
        tenantId: unit.tenantId,
        kind: unit.kind,
        name: unit.name,
        parentId: unit.parentId,
        currency: currencyOf(byId.get(unit.id)!),
        legalEntityIds: members
          .filter((member) => member.unitId === unit.id)
          .map((member) => member.legalEntityId),
      }))
    })

  const one = (tenantId: string, unitId: string) =>
    view(tenantId).pipe(
      Effect.flatMap((units) => {
        const found = units.find((unit) => unit.id === unitId)

        return found === undefined
          ? Effect.fail(new OrgUnitNotFound({ tenantId, unitId }))
          : Effect.succeed(found)
      }),
    )

  const refuse = (tenantId: string, reason: string) =>
    Effect.fail(new OrgUnitInvalid({ tenantId, reason }))

  const create = Effect.fn("OrgUnitService.create")(function* (
    input: Schema.Codec.Encoded<typeof CreateOrgUnitInput>,
  ) {
    const decoded = yield* authorized(CreateOrgUnitInput, PartyCapabilities.orgUnitConfigure)(input)

    if (
      decoded.parentId === undefined &&
      (decoded.kind !== "group" || decoded.currency === undefined)
    ) {
      return yield* refuse(decoded.tenantId, "a root unit is a group with a currency")
    }

    if (decoded.parentId !== undefined && decoded.currency !== undefined) {
      return yield* refuse(decoded.tenantId, "only a root group carries a currency")
    }

    if (decoded.parentId !== undefined) yield* one(decoded.tenantId, decoded.parentId)

    const [row] = yield* database.query(
      (db) =>
        db
          .insert(orgUnits)
          .values({
            tenantId: decoded.tenantId,
            kind: decoded.kind,
            name: decoded.name,
            parentId: decoded.parentId ?? null,
            currency: decoded.currency ?? null,
          })
          .returning({ id: orgUnits.id }),
      "party.org_unit.create",
    )

    return yield* one(decoded.tenantId, row!.id)
  })

  const move = Effect.fn("OrgUnitService.move")(function* (
    input: Schema.Codec.Encoded<typeof MoveOrgUnitInput>,
  ) {
    const decoded = yield* authorized(MoveOrgUnitInput, PartyCapabilities.orgUnitConfigure)(input)
    const unit = yield* one(decoded.tenantId, decoded.unitId)
    yield* one(decoded.tenantId, decoded.parentId)

    // A root group cannot become a child: it would lose the currency the tree is read in.
    if (unit.parentId === null) return yield* refuse(decoded.tenantId, "a root group cannot move")

    yield* database
      .query(
        (db) =>
          db
            .update(orgUnits)
            .set({ parentId: decoded.parentId })
            .where(and(eq(orgUnits.tenantId, decoded.tenantId), eq(orgUnits.id, decoded.unitId))),
        "party.org_unit.move",
      )
      .pipe(
        Effect.mapError((error) =>
          isDatabaseConstraint(error, "org_units_acyclic")
            ? new OrgUnitInvalid({
                tenantId: decoded.tenantId,
                reason: "a unit cannot move under itself or its own subtree",
              })
            : error,
        ),
      )

    return yield* one(decoded.tenantId, decoded.unitId)
  })

  const assignLegalEntity = Effect.fn("OrgUnitService.assignLegalEntity")(function* (
    input: Schema.Codec.Encoded<typeof AssignLegalEntityInput>,
  ) {
    const decoded = yield* authorized(
      AssignLegalEntityInput,
      PartyCapabilities.orgUnitConfigure,
    )(input)

    yield* one(decoded.tenantId, decoded.unitId)

    yield* database
      .query(
        (db) =>
          db
            .insert(orgUnitMembers)
            .values({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              unitId: decoded.unitId,
            })
            .onConflictDoUpdate({
              target: [orgUnitMembers.tenantId, orgUnitMembers.legalEntityId],
              set: { unitId: decoded.unitId },
            }),
        "party.org_unit.assign",
      )
      .pipe(
        Effect.mapError((error) =>
          isDatabaseConstraint(error, "org_unit_members_legal_entity_fkey")
            ? new OrgUnitInvalid({ tenantId: decoded.tenantId, reason: "unknown legal entity" })
            : error,
        ),
      )

    return yield* one(decoded.tenantId, decoded.unitId)
  })

  const list = Effect.fn("OrgUnitService.list")(function* (
    input: Schema.Codec.Encoded<typeof ListOrgUnitsInput>,
  ) {
    const decoded = yield* authorized(ListOrgUnitsInput, PartyCapabilities.partyRead)(input)

    return yield* view(decoded.tenantId)
  })

  const resolve = Effect.fn("OrgUnitService.resolve")(function* (
    input: Schema.Codec.Encoded<typeof ResolveUnitInput>,
  ) {
    const decoded = yield* authorized(ResolveUnitInput, PartyCapabilities.partyRead)(input)
    const unit = yield* one(decoded.tenantId, decoded.unitId)

    const rows = yield* database.query(
      (db) =>
        db
          .select({ legalEntityId: orgUnitMembers.legalEntityId })
          .from(orgUnitMembers)
          .innerJoin(
            orgUnits,
            and(
              eq(orgUnits.tenantId, orgUnitMembers.tenantId),
              eq(orgUnits.id, orgUnitMembers.unitId),
            ),
          )
          .where(
            and(
              eq(orgUnitMembers.tenantId, decoded.tenantId),
              sql`${orgUnits.path} <@ (select path from party.org_units where tenant_id = ${decoded.tenantId} and id = ${decoded.unitId})`,
            ),
          )
          .orderBy(asc(orgUnitMembers.legalEntityId)),
      "party.org_unit.resolve",
    )

    return {
      unitId: decoded.unitId,
      currency: unit.currency,
      legalEntityIds: rows.map((row) => row.legalEntityId),
    } satisfies ResolvedUnit
  })

  return { create, move, assignLegalEntity, list, resolve } satisfies OrgUnitService
})

export const OrgUnitsLive = Layer.effect(OrgUnitService, makeOrgUnitService)
