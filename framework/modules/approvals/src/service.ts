import { and, desc, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { approvalPolicies, approvalRequests } from "../../../../db/schema/approvals.ts"
import { Database, formatSignedMinor, requireExactMajorToMinor } from "../../../foundation/mod.ts"
import { AuthorizationService, Capability } from "../../authorization/mod.ts"
import {
  type ApprovalRequest,
  ApprovalService,
  ConfigurePolicyInput,
  DecideApprovalInput,
  ListApprovalsInput,
  RequirementInput,
  SubjectInput,
  SubmitApprovalInput,
} from "./contract.ts"
import {
  ApprovalAlreadyDecided,
  ApprovalPolicyNotFound,
  ApprovalRequestNotFound,
  SelfApprovalForbidden,
} from "./errors.ts"

export const ApprovalCapabilities = {
  policyConfigure: "approvals.policy.configure",
  requestRead: "approvals.request.read",
} as const

const normalize = (value: string) => formatSignedMinor(requireExactMajorToMinor(value, 2), 2)

const toRequest = (row: typeof approvalRequests.$inferSelect): ApprovalRequest => ({
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
})

export const makeApprovalService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService

  const loadPolicy = (tenantId: string, subjectType: string) =>
    database
      .query(
        (db) =>
          db
            .select()
            .from(approvalPolicies)
            .where(
              and(
                eq(approvalPolicies.tenantId, tenantId),
                eq(approvalPolicies.subjectType, subjectType),
              ),
            ),
        "approvals.policy.get",
      )
      .pipe(Effect.map((rows) => rows[0]))

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
      .pipe(Effect.map((rows) => (rows[0] === undefined ? null : toRequest(rows[0]))))

  const configurePolicy = Effect.fn("ApprovalService.configurePolicy")(function* (
    input: Schema.Codec.Encoded<typeof ConfigurePolicyInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(ConfigurePolicyInput)(input)
    yield* authorization.authorize({
      principal: decoded.principal,
      tenantId: decoded.tenantId,
      capability: ApprovalCapabilities.policyConfigure,
    })
    yield* database.query(
      (db) =>
        db
          .insert(approvalPolicies)
          .values({
            tenantId: decoded.tenantId,
            subjectType: decoded.subjectType,
            threshold: decoded.threshold,
            approverCapability: decoded.approverCapability,
          })
          .onConflictDoUpdate({
            target: [approvalPolicies.tenantId, approvalPolicies.subjectType],
            set: {
              threshold: decoded.threshold,
              approverCapability: decoded.approverCapability,
              updatedAt: new Date(),
            },
          }),
      "approvals.policy.configure",
    )

    return {
      tenantId: decoded.tenantId,
      subjectType: decoded.subjectType,
      threshold: normalize(decoded.threshold),
      approverCapability: decoded.approverCapability,
    }
  })

  const isRequired = Effect.fn("ApprovalService.isRequired")(function* (
    input: Schema.Codec.Encoded<typeof RequirementInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(RequirementInput)(input)
    const policy = yield* loadPolicy(decoded.tenantId, decoded.subjectType)

    return (
      policy !== undefined &&
      requireExactMajorToMinor(decoded.amount, 2) > requireExactMajorToMinor(policy.threshold, 2)
    )
  })

  const submit = Effect.fn("ApprovalService.submit")(function* (
    input: Schema.Codec.Encoded<typeof SubmitApprovalInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(SubmitApprovalInput)(input)
    yield* database.query(
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
          .onConflictDoNothing(),
      "approvals.request.submit",
    )

    return (yield* loadForSubject(decoded.tenantId, decoded.subjectType, decoded.subjectId))!
  })

  const decide = Effect.fn("ApprovalService.decide")(function* (
    input: Schema.Codec.Encoded<typeof DecideApprovalInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(DecideApprovalInput)(input)

    return yield* database.withTransaction(
      Effect.gen(function* () {
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

        const policy = yield* loadPolicy(decoded.tenantId, row.subjectType)

        if (policy === undefined) {
          return yield* Effect.fail(
            new ApprovalPolicyNotFound({
              tenantId: decoded.tenantId,
              subjectType: row.subjectType,
            }),
          )
        }

        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: yield* Schema.decodeUnknownEffect(Capability)(policy.approverCapability),
        })

        if (row.status !== "pending") {
          return yield* Effect.fail(
            new ApprovalAlreadyDecided({
              tenantId: decoded.tenantId,
              requestId: decoded.requestId,
              status: row.status,
            }),
          )
        }

        if (row.requestedBy === decoded.principal.userAccountId) {
          return yield* Effect.fail(
            new SelfApprovalForbidden({ tenantId: decoded.tenantId, requestId: decoded.requestId }),
          )
        }

        const decided = yield* database.query(
          (db) =>
            db
              .update(approvalRequests)
              .set({
                status: decoded.decision === "approve" ? "approved" : "rejected",
                decidedBy: decoded.principal.userAccountId,
                decidedAt: new Date(),
              })
              .where(eq(approvalRequests.id, row.id))
              .returning(),
          "approvals.request.decide",
        )

        return toRequest(decided[0]!)
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

    return rows.map(toRequest)
  })

  const getForSubject = Effect.fn("ApprovalService.getForSubject")(function* (
    input: Schema.Codec.Encoded<typeof SubjectInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(SubjectInput)(input)

    return yield* loadForSubject(decoded.tenantId, decoded.subjectType, decoded.subjectId)
  })

  return {
    configurePolicy,
    isRequired,
    submit,
    decide,
    list,
    getForSubject,
  } satisfies ApprovalService
})

export const ApprovalsLive = Layer.effect(ApprovalService, makeApprovalService)
