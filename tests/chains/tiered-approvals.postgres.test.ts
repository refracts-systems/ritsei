import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"

import { uuidv7 } from "../../framework/foundation/mod.ts"
import {
  ApprovalCapabilities,
  ApprovalService,
  type ApprovalRequestType,
} from "../../framework/modules/approvals/mod.ts"
import { AuthorizationDenied } from "../../framework/modules/authorization/mod.ts"
import { runMigrations } from "../../framework/platform/mod.ts"
import { seedErpFixture } from "../support/erp-fixture.ts"
import { erpChainLayers } from "../support/erp-layers.ts"
import { postgresConstraint } from "../support/postgres-error.ts"
import { withTemporaryDatabase } from "../support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]
const subjectType = "procurement.purchase_order"
const first = "procurement.purchase_order.approve"
const second = "procurement.purchase_order.confirm"

const person = (name: string) => ({ userAccountId: name, sessionId: `${name}-session` })
const buyer = person("tier-buyer")
const lead = person("tier-lead") // holds the first step's capability
const director = person("tier-director") // holds the second step's capability
const both = person("tier-both") // holds both
const deputy = person("tier-deputy") // holds neither
const admin = person("tier-admin") // may revoke any delegation

const at = (date: string) => TestClock.setTime(Date.parse(`${date}T03:00:00.000Z`))

const postgresFailure = <A>(effect: () => Promise<A>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)

// ADR-0128: steps, distinct approvers, and delegation.
it.effect.skipIf(databaseUrl === undefined)(
  "decides a request step by step, keeps SoD and distinct approvers, and honours delegations",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId } = yield* seedErpFixture(client)

        const grants = [
          ...[buyer, lead, both, deputy, director, admin].map((who) => ({
            userAccountId: who.userAccountId,
            tenantId,
            capability: ApprovalCapabilities.requestRead,
          })),
          // The buyer holds the first capability too, so only SoD stops them.
          ...[buyer, lead, both].map((who) => ({
            userAccountId: who.userAccountId,
            tenantId,
            capability: first,
          })),
          ...[director, both].map((who) => ({
            userAccountId: who.userAccountId,
            tenantId,
            capability: second,
          })),
          {
            userAccountId: admin.userAccountId,
            tenantId,
            capability: ApprovalCapabilities.delegationRevoke,
          },
          {
            userAccountId: admin.userAccountId,
            tenantId,
            capability: ApprovalCapabilities.policyConfigure,
          },
        ]

        yield* Effect.gen(function* () {
          const approvals = yield* ApprovalService
          const scope = { principal: buyer, tenantId }
          const adminScope = { principal: admin, tenantId }

          yield* at("2026-10-01")

          // ---- Steps: above 100 needs the first capability; above 1000 also the second.
          const policy = yield* approvals.configurePolicy({
            ...adminScope,
            subjectType,
            steps: [
              { above: "100.00", approverCapability: first },
              { above: "1000.00", approverCapability: second },
            ],
          })

          assert.deepStrictEqual(
            policy.steps.map((step) => [step.stepNumber, step.above, step.upTo]),
            [
              [1, "100.00", null],
              [2, "1000.00", null],
            ],
          )

          const required = (amount: string) =>
            approvals.isRequired({ ...scope, subjectType, amount })

          assert.isFalse(yield* required("100.00"))
          assert.isTrue(yield* required("100.01"))
          assert.isTrue(yield* required("5000.00"))

          const submit = (amount: string) =>
            approvals.submit({
              ...scope,
              subjectType,
              subjectId: uuidv7(),
              amount,
              reason: "order",
            })

          const stepStates = (request: ApprovalRequestType) =>
            request.steps.map((step) => [step.stepNumber, step.approverCapability, step.status])

          // One matching step for 500, two for 5000, in order.
          assert.deepStrictEqual(stepStates(yield* submit("500.00")), [[1, first, "pending"]])

          const big = yield* submit("5000.00")
          assert.deepStrictEqual(stepStates(big), [
            [1, first, "pending"],
            [2, second, "pending"],
          ])

          const decide = (
            who: ReturnType<typeof person>,
            request: ApprovalRequestType,
            decision: "approve" | "reject" = "approve",
          ) =>
            approvals.decide({
              principal: who,
              tenantId,
              requestId: request.id,
              decision,
            })

          // ---- Order: the second capability cannot decide the first step.
          assert.instanceOf(yield* Effect.flip(decide(director, big)), AuthorizationDenied)

          // ---- SoD: the requester holds the capability and is still refused.
          const refused = yield* Effect.flip(decide(buyer, big))
          assert.strictEqual(refused._tag, "SelfApprovalForbidden")

          // ---- A policy change after submission leaves the request's steps alone.
          yield* approvals.configurePolicy({
            ...adminScope,
            subjectType,
            threshold: "1.00",
            approverCapability: second,
          })

          const unchanged = (yield* approvals.getForSubject({
            ...scope,
            subjectType,
            subjectId: big.subjectId,
          }))!

          assert.deepStrictEqual(stepStates(unchanged), stepStates(big))

          // ---- Step 1 approved: the request is still pending, step 2 is next.
          const afterOne = yield* decide(both, big)
          assert.strictEqual(afterOne.status, "pending")
          assert.deepStrictEqual(stepStates(afterOne), [
            [1, first, "approved"],
            [2, second, "pending"],
          ])

          // ---- Distinct approvers: the same person cannot also decide step 2.
          const twice = yield* Effect.flip(decide(both, afterOne))
          assert.strictEqual(twice._tag, "DistinctApproverRequired")

          // ---- The holder of the second capability completes it.
          const done = yield* decide(director, afterOne)
          assert.strictEqual(done.status, "approved")
          assert.strictEqual(done.decidedBy, director.userAccountId)
          assert.strictEqual(done.amount, "5000.00")

          const decidedTwice = yield* Effect.flip(decide(director, done))
          assert.strictEqual(decidedTwice._tag, "ApprovalAlreadyDecided")

          // ---- A rejection at step 1 rejects the request and leaves step 2 undecidable.
          yield* approvals.configurePolicy({
            ...adminScope,
            subjectType,
            steps: [
              { above: "100.00", approverCapability: first },
              { above: "1000.00", approverCapability: second },
            ],
          })

          const doomed = yield* submit("2000.00")
          const rejected = yield* decide(lead, doomed, "reject")
          assert.strictEqual(rejected.status, "rejected")

          assert.deepStrictEqual(stepStates(rejected), [
            [1, first, "rejected"],
            [2, second, "pending"],
          ])

          assert.strictEqual(
            (yield* Effect.flip(decide(director, rejected)))._tag,
            "ApprovalAlreadyDecided",
          )

          // ---- Ranges: a step with an upper bound covers only its band.
          yield* approvals.configurePolicy({
            ...adminScope,
            subjectType: "billing.supplier_bill_variance",
            steps: [
              { above: "0.00", upTo: "100.00", approverCapability: first },
              { above: "100.00", approverCapability: second },
            ],
          })

          const band = (amount: string) =>
            approvals
              .submit({
                ...scope,
                subjectType: "billing.supplier_bill_variance",
                subjectId: uuidv7(),
                amount,
                reason: "variance",
              })
              .pipe(Effect.map((request) => request.steps.map((step) => step.approverCapability)))

          assert.deepStrictEqual(yield* band("100.00"), [first])
          assert.deepStrictEqual(yield* band("100.01"), [second])

          // ---- Policies that cannot be enforced or make no sense are refused.
          for (const steps of [
            [{ above: "1.00", approverCapability: first, scopeLegalEntityId: uuidv7() }],
            [{ above: "5.00", upTo: "5.00", approverCapability: first }],
            [],
          ]) {
            const invalid = yield* Effect.flip(
              approvals.configurePolicy({ ...adminScope, subjectType, steps }),
            )

            assert.strictEqual(invalid._tag, "ApprovalPolicyInvalid")
          }

          // ---- Delegation: a lead hands the first capability to a deputy for a week.
          yield* approvals.configurePolicy({
            ...adminScope,
            subjectType,
            steps: [{ above: "100.00", approverCapability: first }],
          })

          const delegate = (
            from: ReturnType<typeof person>,
            to: string,
            validFrom: string,
            validTo: string,
            capability = first,
          ) =>
            approvals.createDelegation({
              principal: from,
              tenantId,
              delegate: to,
              capability,
              validFrom,
              validTo,
              reason: "away",
            })

          const needsApproval = yield* submit("300.00")
          assert.instanceOf(yield* Effect.flip(decide(deputy, needsApproval)), AuthorizationDenied)

          // Not to oneself, not backwards, and only what the delegator holds.
          assert.strictEqual(
            (yield* Effect.flip(delegate(lead, lead.userAccountId, "2026-10-01", "2026-10-07")))
              ._tag,
            "DelegationInvalid",
          )

          assert.strictEqual(
            (yield* Effect.flip(delegate(lead, deputy.userAccountId, "2026-10-07", "2026-10-01")))
              ._tag,
            "DelegationInvalid",
          )

          assert.instanceOf(
            yield* Effect.flip(
              delegate(lead, deputy.userAccountId, "2026-10-01", "2026-10-07", second),
            ),
            AuthorizationDenied,
          )

          // A delegate cannot pass it on: they do not hold the capability themselves.
          const given = yield* delegate(lead, deputy.userAccountId, "2026-10-02", "2026-10-07")

          assert.instanceOf(
            yield* Effect.flip(delegate(deputy, buyer.userAccountId, "2026-10-02", "2026-10-07")),
            AuthorizationDenied,
          )

          // Before it starts, the deputy still cannot decide; the step lists no delegate yet.
          assert.instanceOf(yield* Effect.flip(decide(deputy, needsApproval)), AuthorizationDenied)
          assert.deepStrictEqual(needsApproval.steps[0]!.delegates, [])

          // In force: the step shows who may decide it, and the deputy decides for the lead.
          yield* at("2026-10-03")

          const shown = (yield* approvals.getForSubject({
            ...scope,
            subjectType,
            subjectId: needsApproval.subjectId,
          }))!

          assert.deepStrictEqual(
            shown.steps[0]!.delegates.map((entry) => [
              entry.delegator,
              entry.delegate,
              entry.validTo,
            ]),
            [[lead.userAccountId, deputy.userAccountId, "2026-10-07"]],
          )

          const viaDeputy = yield* decide(deputy, needsApproval)
          assert.strictEqual(viaDeputy.status, "approved")
          assert.strictEqual(viaDeputy.steps[0]!.decidedBy, deputy.userAccountId)
          assert.strictEqual(viaDeputy.steps[0]!.onBehalfOf, lead.userAccountId)

          // The delegator who acted through a delegate cannot decide a second step too.
          yield* approvals.configurePolicy({
            ...adminScope,
            subjectType,
            steps: [
              { above: "100.00", approverCapability: first },
              { above: "100.00", approverCapability: first },
            ],
          })

          const chain = yield* submit("400.00")
          yield* decide(deputy, chain)
          assert.strictEqual(
            (yield* Effect.flip(decide(lead, chain)))._tag,
            "DistinctApproverRequired",
          )

          // After its end date the delegation no longer works.
          yield* at("2026-10-08")
          const late = yield* submit("350.00")
          yield* approvals.configurePolicy({
            ...adminScope,
            subjectType,
            steps: [{ above: "100.00", approverCapability: first }],
          })

          assert.instanceOf(yield* Effect.flip(decide(deputy, late)), AuthorizationDenied)

          // ---- Revoking: the delegator or a holder of the revoke capability, once.
          yield* at("2026-10-09")
          const week = yield* delegate(lead, deputy.userAccountId, "2026-10-09", "2026-10-15")

          assert.instanceOf(
            yield* Effect.flip(
              approvals.revokeDelegation({ principal: buyer, tenantId, delegationId: week.id }),
            ),
            AuthorizationDenied,
          )

          const revoked = yield* approvals.revokeDelegation({
            principal: admin,
            tenantId,
            delegationId: week.id,
          })

          assert.strictEqual(revoked.revokedBy, admin.userAccountId)

          assert.strictEqual(
            (yield* Effect.flip(
              approvals.revokeDelegation({ principal: lead, tenantId, delegationId: week.id }),
            ))._tag,
            "DelegationAlreadyRevoked",
          )

          const afterRevoke = yield* submit("360.00")
          assert.instanceOf(yield* Effect.flip(decide(deputy, afterRevoke)), AuthorizationDenied)

          assert.strictEqual(
            (yield* Effect.flip(
              approvals.revokeDelegation({ principal: lead, tenantId, delegationId: uuidv7() }),
            ))._tag,
            "DelegationNotFound",
          )

          // ---- Through a delegation the requester is still refused.
          const toBuyer = yield* delegate(lead, buyer.userAccountId, "2026-10-09", "2026-10-15")
          assert.strictEqual(toBuyer.delegate, buyer.userAccountId)
          const own = yield* submit("370.00")
          assert.strictEqual((yield* Effect.flip(decide(buyer, own)))._tag, "SelfApprovalForbidden")

          // A requester who is the delegator cannot be stood in for either.
          yield* delegate(lead, deputy.userAccountId, "2026-10-09", "2026-10-15")

          const leadRequest = yield* approvals.submit({
            principal: lead,
            tenantId,
            subjectType,
            subjectId: uuidv7(),
            amount: "380.00",
            reason: "order",
          })

          assert.strictEqual(
            (yield* Effect.flip(decide(deputy, leadRequest)))._tag,
            "SelfApprovalForbidden",
          )

          // ---- Mine and all.
          assert.isAbove(
            (yield* approvals.listDelegations({ principal: deputy, tenantId })).length,
            0,
          )

          assert.instanceOf(
            yield* Effect.flip(
              approvals.listDelegations({
                principal: person("tier-outsider"),
                tenantId,
                scope: "all",
              }),
            ),
            AuthorizationDenied,
          )

          assert.isAbove(
            (yield* approvals.listDelegations({ principal: admin, tenantId, scope: "all" })).length,
            0,
          )

          // ---- The record only grows: no edit but a revocation, and no delete.
          const edited = yield* postgresFailure(
            () =>
              client`update approvals.approval_delegations set reason = 'x' where id = ${given.id}`,
          )

          assert.strictEqual(postgresConstraint(edited), "approval_delegations_append_only")

          const removed = yield* postgresFailure(
            () => client`delete from approvals.approval_delegations where id = ${given.id}`,
          )

          assert.strictEqual(postgresConstraint(removed), "approval_delegations_append_only")
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 240_000 },
)
