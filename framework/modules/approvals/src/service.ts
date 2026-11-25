import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  approvalDelegations,
  approvalPolicies,
  approvalPolicySteps,
  approvalRequests,
  approvalRequestSteps,
} from "../../../../db/schema/approvals.ts"
import { Database, formatSignedMinor, requireExactMajorToMinor } from "../../../foundation/mod.ts"
import { AuthorizationService, Capability } from "../../authorization/mod.ts"
import {
  type ApprovalPolicy,
  type ApprovalRequest,
  type ApprovalRequestStep,
  ApprovalService,
  ConfigurePolicyInput,
  CreateDelegationInput,
  DecideApprovalInput,
  type Delegation,
  ListApprovalsInput,
  ListDelegationsInput,
  RequirementInput,
  RevokeDelegationInput,
  SubjectInput,
  SubmitApprovalInput,
  type WaitingApproval,
  WaitingInput,
} from "./contract.ts"
import {
  ApprovalAlreadyDecided,
  ApprovalPolicyInvalid,
  ApprovalPolicyNotFound,
  ApprovalRequestNotFound,
  DelegationAlreadyRevoked,
  DelegationInvalid,
  DelegationNotFound,
  DistinctApproverRequired,
  SelfApprovalForbidden,
} from "./errors.ts"

export const ApprovalCapabilities = {
  policyConfigure: "approvals.policy.configure",
  requestRead: "approvals.request.read",
  delegationRevoke: "approvals.delegation.revoke",
} as const

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const normalize = (value: string) => formatSignedMinor(minor(value), 2)

type StepRow = typeof approvalRequestSteps.$inferSelect

type DelegationRow = typeof approvalDelegations.$inferSelect

const toDelegation = (row: DelegationRow): Delegation => ({
  id: row.id,
  tenantId: row.tenantId,
  delegator: row.delegator,
  delegate: row.delegate,
  capability: row.capability,
  validFrom: row.validFrom,
  validTo: row.validTo,
  reason: row.reason,
  createdAt: row.createdAt.toISOString(),
  revokedAt: row.revokedAt?.toISOString() ?? null,
  revokedBy: row.revokedBy,
})

const toStep = (row: StepRow, inForce: ReadonlyArray<DelegationRow>): ApprovalRequestStep => ({
  stepNumber: row.stepNumber,
  approverCapability: row.approverCapability,
  scopeLegalEntityId: row.scopeLegalEntityId,
  status: row.status,
  decidedBy: row.decidedBy,
  onBehalfOf: row.onBehalfOf,
  decidedAt: row.decidedAt?.toISOString() ?? null,
  delegates:
    row.status === "pending"
      ? inForce.flatMap((delegation) =>
          delegation.capability === row.approverCapability
            ? [
                {
                  delegationId: delegation.id,
                  delegator: delegation.delegator,
                  delegate: delegation.delegate,
                  validTo: delegation.validTo,
                },
              ]
            : [],
        )
      : [],
})

const toRequest = (
  row: typeof approvalRequests.$inferSelect,
  steps: ReadonlyArray<ApprovalRequestStep>,
): ApprovalRequest => ({
  id: row.id,
  tenantId: row.tenantId,
  subjectType: row.subjectType,
  subjectId: row.subjectId,
  amount: normalize(row.amount),
  reason: row.reason,
  status: row.status,
  requestedBy: row.requestedBy,
  decidedBy: row.decidedBy,
  decidedAt: row.decidedAt?.toISOString() ?? null,
  steps,
})

/** A rejection ends a request; an approval ends it only at its last undecided step. */
const endsRequest = (
  status: "approved" | "rejected",
  steps: ReadonlyArray<StepRow>,
  decidedStep: number,
) =>
  status === "rejected" ||
  steps.every((step) => step.stepNumber === decidedStep || step.status === "approved")

/** Whether an amount is above a step's lower bound and not above its upper bound. */
const covers = (step: { above: string; upTo: string | null }, amount: string) =>
  minor(amount) > minor(step.above) && (step.upTo === null || minor(amount) <= minor(step.upTo))

export const makeApprovalService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService

  const today = Effect.gen(function* () {
    const clock = yield* Clock.Clock

    return new Date(clock.currentTimeMillisUnsafe()).toISOString().slice(0, 10)
  })

  const loadSteps = (tenantId: string, subjectType: string) =>
    database.query(
      (db) =>
        db
          .select()
          .from(approvalPolicySteps)
          .where(
            and(
              eq(approvalPolicySteps.tenantId, tenantId),
              eq(approvalPolicySteps.subjectType, subjectType),
            ),
          )
          .orderBy(asc(approvalPolicySteps.stepNumber)),
      "approvals.policy.steps",
    )

  /** The delegations in force on a day for these capabilities. */
  const inForce = (tenantId: string, capabilities: ReadonlyArray<string>, day: string) =>
    capabilities.length === 0
      ? Effect.succeed<ReadonlyArray<DelegationRow>>([])
      : database.query(
          (db) =>
            db
              .select()
              .from(approvalDelegations)
              .where(
                and(
                  eq(approvalDelegations.tenantId, tenantId),
                  inArray(approvalDelegations.capability, [...capabilities]),
                  isNull(approvalDelegations.revokedAt),
                  lte(approvalDelegations.validFrom, day),
                  gte(approvalDelegations.validTo, day),
                ),
              )
              .orderBy(asc(approvalDelegations.createdAt)),
          "approvals.delegation.in_force",
        )

  const withSteps = (rows: ReadonlyArray<typeof approvalRequests.$inferSelect>) =>
    Effect.gen(function* () {
      if (rows.length === 0) return []

      const steps = yield* database.query(
        (db) =>
          db
            .select()
            .from(approvalRequestSteps)
            .where(
              and(
                eq(approvalRequestSteps.tenantId, rows[0]!.tenantId),
                inArray(
                  approvalRequestSteps.requestId,
                  rows.map((row) => row.id),
                ),
              ),
            )
            .orderBy(asc(approvalRequestSteps.stepNumber)),
        "approvals.request.steps",
      )

      const delegations = yield* inForce(
        rows[0]!.tenantId,
        [...new Set(steps.map((step) => step.approverCapability))],
        yield* today,
      )

      return rows.map((row) =>
        toRequest(
          row,
          steps
            .filter((step) => step.requestId === row.id)
            .map((step) => toStep(step, delegations)),
        ),
      )
    })

  const loadForSubject = (tenantId: string, subjectType: string, subjectId: string) =>
    database
      .query(
        (db) =>
          db
            .select()
            .from(approvalRequests)
            .where(
              and(
                eq(approvalRequests.tenantId, tenantId),
                eq(approvalRequests.subjectType, subjectType),
                eq(approvalRequests.subjectId, subjectId),
              ),
            ),
        "approvals.request.by_subject",
      )
      .pipe(
        Effect.flatMap(withSteps),
        Effect.map((requests) => requests[0] ?? null),
      )

  const configurePolicy = Effect.fn("ApprovalService.configurePolicy")(function* (
    input: Schema.Codec.Encoded<typeof ConfigurePolicyInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(ConfigurePolicyInput)(input)

    yield* authorization.authorize({
      principal: decoded.principal,
      tenantId: decoded.tenantId,
      capability: ApprovalCapabilities.policyConfigure,
    })

    const invalid = (reason: string) =>
      Effect.fail(new ApprovalPolicyInvalid({ tenantId: decoded.tenantId, reason }))

    const requested = decoded.steps ?? [
      { above: decoded.threshold!, approverCapability: decoded.approverCapability! },
    ]

    if (requested.length === 0) return yield* invalid("a policy needs at least one step")

    for (const step of requested) {
      if (step.scopeLegalEntityId !== undefined) {
        return yield* invalid("a step scope is not enforced yet, so it is refused")
      }

      if (step.upTo !== undefined && minor(step.upTo) <= minor(step.above)) {
        return yield* invalid("a step must end above where it starts")
      }

      yield* Schema.decodeUnknownEffect(Capability)(step.approverCapability).pipe(
        Effect.mapError(
          () =>
            new ApprovalPolicyInvalid({ tenantId: decoded.tenantId, reason: "unknown capability" }),
        ),
      )
    }

    // The policy and its steps are replaced together; requests already submitted keep their own.
    yield* database.withTransaction(
      Effect.gen(function* () {
        yield* database.query(
          (db) =>
            db
              .insert(approvalPolicies)
              .values({ tenantId: decoded.tenantId, subjectType: decoded.subjectType })
              .onConflictDoUpdate({
                target: [approvalPolicies.tenantId, approvalPolicies.subjectType],
                set: { updatedAt: new Date() },
              }),
          "approvals.policy.configure",
        )

        yield* database.query(
          (db) =>
            db
              .delete(approvalPolicySteps)
              .where(
                and(
                  eq(approvalPolicySteps.tenantId, decoded.tenantId),
                  eq(approvalPolicySteps.subjectType, decoded.subjectType),
                ),
              ),
          "approvals.policy.steps.clear",
        )

        yield* database.query(
          (db) =>
            db.insert(approvalPolicySteps).values(
              requested.map((step, index) => ({
                tenantId: decoded.tenantId,
                subjectType: decoded.subjectType,
                stepNumber: index + 1,
                above: step.above,
                upTo: step.upTo ?? null,
                approverCapability: step.approverCapability,
              })),
            ),
          "approvals.policy.steps.insert",
        )
      }),
      "approvals.policy.configure.atomic",
    )

    return {
      tenantId: decoded.tenantId,
      subjectType: decoded.subjectType,
      steps: requested.map((step, index) => ({
        stepNumber: index + 1,
        above: normalize(step.above),
        upTo: step.upTo === undefined ? null : normalize(step.upTo),
        approverCapability: step.approverCapability,
        scopeLegalEntityId: null,
      })),
    } satisfies ApprovalPolicy
  })

  const isRequired = Effect.fn("ApprovalService.isRequired")(function* (
    input: Schema.Codec.Encoded<typeof RequirementInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(RequirementInput)(input)
    const steps = yield* loadSteps(decoded.tenantId, decoded.subjectType)

    return steps.some((step) => covers(step, decoded.amount))
  })

  const submit = Effect.fn("ApprovalService.submit")(function* (
    input: Schema.Codec.Encoded<typeof SubmitApprovalInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(SubmitApprovalInput)(input)

    yield* database.withTransaction(
      Effect.gen(function* () {
        const created = yield* database.query(
          (db) =>
            db
              .insert(approvalRequests)
              .values({
                tenantId: decoded.tenantId,
                subjectType: decoded.subjectType,
                subjectId: decoded.subjectId,
                amount: decoded.amount,
                reason: decoded.reason,
                requestedBy: decoded.principal.userAccountId,
              })
              .onConflictDoNothing()
              .returning({ id: approvalRequests.id }),
          "approvals.request.submit",
        )

        if (created[0] === undefined) return

        // The steps that cover the amount are copied now, so a later policy change leaves this
        // request as it was.
        const matching = (yield* loadSteps(decoded.tenantId, decoded.subjectType)).filter((step) =>
          covers(step, decoded.amount),
        )

        if (matching.length === 0) return

        yield* database.query(
          (db) =>
            db.insert(approvalRequestSteps).values(
              matching.map((step, index) => ({
                tenantId: decoded.tenantId,
                requestId: created[0]!.id,
                stepNumber: index + 1,
                approverCapability: step.approverCapability,
                scopeLegalEntityId: step.scopeLegalEntityId,
                requestedBy: decoded.principal.userAccountId,
              })),
            ),
          "approvals.request.steps.insert",
        )
      }),
      "approvals.request.submit.atomic",
    )

    return (yield* loadForSubject(decoded.tenantId, decoded.subjectType, decoded.subjectId))!
  })

  /**
   * Who a decision counts as: the caller themself when they hold the step's capability, otherwise the
   * delegator whose delegation in force lets them decide, as long as that delegator still holds it.
   */
  const actingFor = Effect.fn("ApprovalService.actingFor")(function* (
    decoded: Schema.Schema.Type<typeof DecideApprovalInput>,
    step: StepRow,
    day: string,
  ) {
    const capability = yield* Schema.decodeUnknownEffect(Capability)(step.approverCapability)

    return yield* authorization
      .authorize({ principal: decoded.principal, tenantId: decoded.tenantId, capability })
      .pipe(
        Effect.as<string | null>(null),
        Effect.catchTag("AuthorizationDenied", (denied) =>
          Effect.gen(function* () {
            const delegations = yield* database.query(
              (db) =>
                db
                  .select()
                  .from(approvalDelegations)
                  .where(
                    and(
                      eq(approvalDelegations.tenantId, decoded.tenantId),
                      eq(approvalDelegations.delegate, decoded.principal.userAccountId),
                      eq(approvalDelegations.capability, step.approverCapability),
                      isNull(approvalDelegations.revokedAt),
                      lte(approvalDelegations.validFrom, day),
                      gte(approvalDelegations.validTo, day),
                    ),
                  )
                  .orderBy(asc(approvalDelegations.createdAt)),
              "approvals.delegation.for_delegate",
            )

            for (const delegation of delegations) {
              const holds = yield* authorization
                .authorize({
                  principal: { userAccountId: delegation.delegator, sessionId: "delegation" },
                  tenantId: decoded.tenantId,
                  capability,
                })
                .pipe(
                  Effect.as(true),
                  Effect.catchTag("AuthorizationDenied", () => Effect.succeed(false)),
                )

              if (holds) return delegation.delegator
            }

            return yield* Effect.fail(denied)
          }),
        ),
      )
  })

  /** The refusal separation of duties and distinct approvers call for, if any. */
  const conflictOf = (
    row: typeof approvalRequests.$inferSelect,
    steps: ReadonlyArray<StepRow>,
    decider: string,
    onBehalfOf: string | null,
  ) => {
    const scope = { tenantId: row.tenantId, requestId: row.id }

    // The requester never decides, nor through a delegation.
    if (row.requestedBy === decider || row.requestedBy === onBehalfOf) {
      return new SelfApprovalForbidden(scope)
    }

    // One person decides one step: not the same user, nor the person they acted for.
    const people = new Set([decider, ...(onBehalfOf === null ? [] : [onBehalfOf])])

    const decidedBefore = steps.some(
      (step) =>
        (step.decidedBy !== null && people.has(step.decidedBy)) ||
        (step.onBehalfOf !== null && people.has(step.onBehalfOf)),
    )

    return decidedBefore ? new DistinctApproverRequired(scope) : undefined
  }

  /** The request locked with its steps, and the step that is next to be decided (or the last). */
  const lockRequest = Effect.fn("ApprovalService.lockRequest")(function* (
    decoded: Schema.Schema.Type<typeof DecideApprovalInput>,
  ) {
    const row = (yield* database.query(
      (db) =>
        db
          .select()
          .from(approvalRequests)
          .where(
            and(
              eq(approvalRequests.tenantId, decoded.tenantId),
              eq(approvalRequests.id, decoded.requestId),
            ),
          )
          .for("update"),
      "approvals.request.lock",
    ))[0]

    if (row === undefined) {
      return yield* Effect.fail(
        new ApprovalRequestNotFound({
          tenantId: decoded.tenantId,
          requestId: decoded.requestId,
        }),
      )
    }

    const steps = yield* database.query(
      (db) =>
        db
          .select()
          .from(approvalRequestSteps)
          .where(
            and(
              eq(approvalRequestSteps.tenantId, decoded.tenantId),
              eq(approvalRequestSteps.requestId, row.id),
            ),
          )
          .orderBy(asc(approvalRequestSteps.stepNumber)),
      "approvals.request.steps.lock",
    )

    const current = steps.find((step) => step.status === "pending") ?? steps.at(-1)

    if (current === undefined) {
      return yield* Effect.fail(
        new ApprovalPolicyNotFound({
          tenantId: decoded.tenantId,
          subjectType: row.subjectType,
        }),
      )
    }

    return { row, steps, current }
  })

  const decide = Effect.fn("ApprovalService.decide")(function* (
    input: Schema.Codec.Encoded<typeof DecideApprovalInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(DecideApprovalInput)(input)
    const day = yield* today
    const decider = decoded.principal.userAccountId

    return yield* database.withTransaction(
      Effect.gen(function* () {
        const { row, steps, current } = yield* lockRequest(decoded)

        const onBehalfOf = yield* actingFor(decoded, current, day)

        if (row.status !== "pending" || current.status !== "pending") {
          return yield* Effect.fail(
            new ApprovalAlreadyDecided({
              tenantId: decoded.tenantId,
              requestId: decoded.requestId,
              status: row.status,
            }),
          )
        }

        const conflict = conflictOf(row, steps, decider, onBehalfOf)

        if (conflict !== undefined) return yield* Effect.fail(conflict)

        const status = decoded.decision === "approve" ? "approved" : "rejected"
        const decidedAt = new Date()

        yield* database.query(
          (db) =>
            db
              .update(approvalRequestSteps)
              .set({ status, decidedBy: decider, onBehalfOf, decidedAt })
              .where(
                and(
                  eq(approvalRequestSteps.tenantId, decoded.tenantId),
                  eq(approvalRequestSteps.requestId, row.id),
                  eq(approvalRequestSteps.stepNumber, current.stepNumber),
                ),
              ),
          "approvals.request.step.decide",
        )

        const finished = endsRequest(status, steps, current.stepNumber)

        const updated = finished
          ? (yield* database.query(
              (db) =>
                db
                  .update(approvalRequests)
                  .set({ status, decidedBy: decider, decidedAt })
                  .where(eq(approvalRequests.id, row.id))
                  .returning(),
              "approvals.request.decide",
            ))[0]!
          : row

        return (yield* withSteps([updated]))[0]!
      }),
      "approvals.request.decide.atomic",
    )
  })

  const list = Effect.fn("ApprovalService.list")(function* (
    input: Schema.Codec.Encoded<typeof ListApprovalsInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(ListApprovalsInput)(input)

    yield* authorization.authorize({
      principal: decoded.principal,
      tenantId: decoded.tenantId,
      capability: ApprovalCapabilities.requestRead,
    })

    const rows = yield* database.query(
      (db) =>
        db
          .select()
          .from(approvalRequests)
          .where(
            and(
              eq(approvalRequests.tenantId, decoded.tenantId),
              ...(decoded.status === undefined
                ? []
                : [eq(approvalRequests.status, decoded.status)]),
            ),
          )
          .orderBy(desc(approvalRequests.createdAt), desc(approvalRequests.id))
          .limit(decoded.limit ?? 100),
      "approvals.request.list",
    )

    return yield* withSteps(rows)
  })

  const listWaiting = Effect.fn("ApprovalService.listWaiting")(function* (
    input: Schema.Codec.Encoded<typeof WaitingInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(WaitingInput)(input)

    yield* authorization.authorize({
      principal: decoded.principal,
      tenantId: decoded.tenantId,
      capability: ApprovalCapabilities.requestRead,
    })

    const rows = yield* database.query(
      (db) =>
        db
          .select()
          .from(approvalRequests)
          .where(
            and(
              eq(approvalRequests.tenantId, decoded.tenantId),
              eq(approvalRequests.status, "pending"),
              lt(approvalRequests.createdAt, new Date(decoded.olderThan)),
            ),
          )
          .orderBy(asc(approvalRequests.createdAt), asc(approvalRequests.id))
          .limit(500),
      "approvals.request.waiting",
    )

    const lastSteps = new Map<string, { above: string; upTo: string | null } | undefined>()

    for (const subjectType of new Set(rows.map((row) => row.subjectType))) {
      lastSteps.set(subjectType, (yield* loadSteps(decoded.tenantId, subjectType)).at(-1))
    }

    return rows.map((row): WaitingApproval => {
      const last = lastSteps.get(row.subjectType)

      return {
        requestId: row.id,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        amount: normalize(row.amount),
        requestedAt: row.createdAt.toISOString(),
        reachesLastStep: last !== undefined && covers(last, row.amount),
      }
    })
  })

  const getForSubject = Effect.fn("ApprovalService.getForSubject")(function* (
    input: Schema.Codec.Encoded<typeof SubjectInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(SubjectInput)(input)

    return yield* loadForSubject(decoded.tenantId, decoded.subjectType, decoded.subjectId)
  })

  const createDelegation = Effect.fn("ApprovalService.createDelegation")(function* (
    input: Schema.Codec.Encoded<typeof CreateDelegationInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(CreateDelegationInput)(input)
    const delegator = decoded.principal.userAccountId

    // A delegator can only hand over what they hold themselves, so a delegate cannot pass it on.
    yield* authorization.authorize({
      principal: decoded.principal,
      tenantId: decoded.tenantId,
      capability: yield* Schema.decodeUnknownEffect(Capability)(decoded.capability),
    })

    const refuse = (reason: string) =>
      Effect.fail(new DelegationInvalid({ tenantId: decoded.tenantId, reason }))

    if (decoded.delegate === delegator) return yield* refuse("a delegation to oneself")

    if (decoded.validTo < decoded.validFrom) return yield* refuse("the dates run backwards")

    const created = yield* database.query(
      (db) =>
        db
          .insert(approvalDelegations)
          .values({
            tenantId: decoded.tenantId,
            delegator,
            delegate: decoded.delegate,
            capability: decoded.capability,
            validFrom: decoded.validFrom,
            validTo: decoded.validTo,
            reason: decoded.reason,
          })
          .returning(),
      "approvals.delegation.create",
    )

    return toDelegation(created[0]!)
  })

  const revokeDelegation = Effect.fn("ApprovalService.revokeDelegation")(function* (
    input: Schema.Codec.Encoded<typeof RevokeDelegationInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(RevokeDelegationInput)(input)

    return yield* database.withTransaction(
      Effect.gen(function* () {
        const row = (yield* database.query(
          (db) =>
            db
              .select()
              .from(approvalDelegations)
              .where(
                and(
                  eq(approvalDelegations.tenantId, decoded.tenantId),
                  eq(approvalDelegations.id, decoded.delegationId),
                ),
              )
              .for("update"),
          "approvals.delegation.lock",
        ))[0]

        if (row === undefined) {
          return yield* Effect.fail(
            new DelegationNotFound({
              tenantId: decoded.tenantId,
              delegationId: decoded.delegationId,
            }),
          )
        }

        // The delegator revokes their own; anyone else needs the revoke capability.
        if (row.delegator !== decoded.principal.userAccountId) {
          yield* authorization.authorize({
            principal: decoded.principal,
            tenantId: decoded.tenantId,
            capability: ApprovalCapabilities.delegationRevoke,
          })
        }

        if (row.revokedAt !== null) {
          return yield* Effect.fail(
            new DelegationAlreadyRevoked({
              tenantId: decoded.tenantId,
              delegationId: decoded.delegationId,
            }),
          )
        }

        const revoked = yield* database.query(
          (db) =>
            db
              .update(approvalDelegations)
              .set({ revokedAt: new Date(), revokedBy: decoded.principal.userAccountId })
              .where(eq(approvalDelegations.id, row.id))
              .returning(),
          "approvals.delegation.revoke",
        )

        return toDelegation(revoked[0]!)
      }),
      "approvals.delegation.revoke.atomic",
    )
  })

  const listDelegations = Effect.fn("ApprovalService.listDelegations")(function* (
    input: Schema.Codec.Encoded<typeof ListDelegationsInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(ListDelegationsInput)(input)
    const me = decoded.principal.userAccountId

    if (decoded.scope === "all") {
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: ApprovalCapabilities.requestRead,
      })
    }

    const rows = yield* database.query(
      (db) =>
        db
          .select()
          .from(approvalDelegations)
          .where(
            and(
              eq(approvalDelegations.tenantId, decoded.tenantId),
              decoded.scope === "all"
                ? undefined
                : or(eq(approvalDelegations.delegator, me), eq(approvalDelegations.delegate, me)),
            ),
          )
          .orderBy(desc(approvalDelegations.createdAt), desc(approvalDelegations.id))
          .limit(200),
      "approvals.delegation.list",
    )

    return rows.map(toDelegation)
  })

  return {
    configurePolicy,
    isRequired,
    submit,
    decide,
    list,
    getForSubject,
    listWaiting,
    createDelegation,
    revokeDelegation,
    listDelegations,
  } satisfies ApprovalService
})

export const ApprovalsLive = Layer.effect(ApprovalService, makeApprovalService)
