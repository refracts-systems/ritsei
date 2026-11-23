/**
 * The claim protocol of ADR-0124 phase 3, modelled on the sales order confirmation key
 * (`SAL-ORDER-2`). A confirmation key must be unused by every other order in the tenant. One
 * aggregate instance cannot see another, so the key is claimed on its own aggregate first, and only
 * then confirmed on the order.
 *
 * - **Claim first, then record.** The failure left by claiming first is a false conflict (a key held
 *   by an order that never carried it), which a sweep repairs. Recording first would leave two
 *   orders confirmed under one key, which nothing repairs.
 * - **Compensation releases only what this run took.** A retry finds the claim already held by the
 *   same order, takes nothing, and so releases nothing even when the confirmation fails (a cancelled
 *   order keeps the key it was confirmed with).
 * - **A crash between the two steps leaves a claim held by an order that does not carry the key.**
 *   The same order's retry proceeds; another order sees `ClaimHeld` until `staleClaim` says the
 *   holder does not carry the key and a sweep releases it.
 *
 * Test-only, like the other models: not exported from `mod.ts`. The claim aggregate is generic in
 * shape and is the part another module would copy; it is kept here until a second consumer exists.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { Activity, Workflow } from "effect/workflow"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  ConfirmOrder,
  OrderId,
  SalesOrder,
  SalesOrderConfirmationIdempotencyConflict,
  SalesOrderInvalidState,
  SalesOrderNotFound,
} from "./domain-model.ts"

// ---------------------------------------------------------------- the claim aggregate

/** `<tenant>/<confirmation key>`: the tenant comes from the caller, never from the command. */
export const ClaimId = Schema.String.pipe(Schema.brand("ConfirmationKeyClaimId"))

export class ClaimHeld extends Domain.Rejection("ClaimHeld", { holder: Schema.String }) {}

export class KeyClaimed extends Domain.Event("KeyClaimed", { holder: Schema.String }) {}

export class KeyReleased extends Domain.Event("KeyReleased", { holder: Schema.String }) {}

export class ClaimKey extends Domain.Command("ClaimKey", {
  target: ClaimId,
  input: { holder: Schema.String },
  events: [KeyClaimed],
  rejects: [ClaimHeld],
}) {}

export class ReleaseKey extends Domain.Command("ReleaseKey", {
  target: ClaimId,
  input: { holder: Schema.String },
  events: [KeyReleased],
}) {}

const Free = Schema.TaggedStruct("Free", {})
const Held = Schema.TaggedStruct("Held", { holder: Schema.String })
const ClaimState = Schema.Union([Free, Held])

/**
 * Whether a claim is stale: held by an order that does not carry the key. The sweep reads the order
 * (another aggregate), then asks this pure function; it releases only on `true`.
 */
export const staleClaim = (heldBy: string, carriedBy: string | undefined) => carriedBy !== heldBy

export class ConfirmationKeyClaim extends Domain.Aggregate("ConfirmationKeyClaim", {
  id: ClaimId,
  state: ClaimState,
  initial: Free.make({}),
  commands: [ClaimKey, ReleaseKey],
  decide: {
    ClaimKey: (claim, cmd) => {
      if (!Predicate.isTagged(claim, "Held")) return [new KeyClaimed({ holder: cmd.holder })]

      return claim.holder === cmd.holder ? [] : new ClaimHeld({ holder: claim.holder })
    },
    ReleaseKey: (claim, cmd) =>
      Predicate.isTagged(claim, "Held") && claim.holder === cmd.holder
        ? [new KeyReleased({ holder: cmd.holder })]
        : [],
  },
  evolve: {
    KeyClaimed: (_, e) => Held.make({ holder: e.holder }),
    KeyReleased: () => Free.make({}),
  },
}) {}

// ---------------------------------------------------------------- the request and the saga

export const RequestId = Schema.String.pipe(Schema.brand("ConfirmationRequestId"))

export class ConfirmationRequested extends Domain.Event("ConfirmationRequested", {
  orderId: Schema.String,
  confirmationKey: Schema.String,
  claimId: Schema.String,
}) {}

export class ConfirmationCompleted extends Domain.Event("ConfirmationCompleted", {}) {}

export class ConfirmationRefused extends Domain.Event("ConfirmationRefused", {
  reason: Schema.String,
}) {}

export class RequestConfirmation extends Domain.Command("RequestConfirmation", {
  target: RequestId,
  input: { orderId: Schema.String, confirmationKey: Schema.String, claimId: Schema.String },
  events: [ConfirmationRequested],
}) {}

export class CompleteConfirmation extends Domain.Command("CompleteConfirmation", {
  target: RequestId,
  input: {},
  events: [ConfirmationCompleted],
}) {}

export class RefuseConfirmation extends Domain.Command("RefuseConfirmation", {
  target: RequestId,
  input: { reason: Schema.String },
  events: [ConfirmationRefused],
}) {}

const NoRequest = Schema.TaggedStruct("NoRequest", {})
const InProgress = Schema.TaggedStruct("InProgress", {})
const Completed = Schema.TaggedStruct("Completed", {})
const Refused = Schema.TaggedStruct("Refused", { reason: Schema.String })

export class ConfirmationRequest extends Domain.Aggregate("ConfirmationRequest", {
  id: RequestId,
  state: Schema.Union([NoRequest, InProgress, Completed, Refused]),
  initial: NoRequest.make({}),
  commands: [RequestConfirmation, CompleteConfirmation, RefuseConfirmation],
  decide: {
    RequestConfirmation: (s, cmd) =>
      Predicate.isTagged(s, "NoRequest")
        ? [
            new ConfirmationRequested({
              orderId: cmd.orderId,
              confirmationKey: cmd.confirmationKey,
              claimId: cmd.claimId,
            }),
          ]
        : [],
    CompleteConfirmation: (s) =>
      Predicate.isTagged(s, "InProgress") ? [new ConfirmationCompleted()] : [],
    RefuseConfirmation: (s, cmd) =>
      Predicate.isTagged(s, "InProgress") ? [new ConfirmationRefused({ reason: cmd.reason })] : [],
  },
  evolve: {
    ConfirmationRequested: () => InProgress.make({}),
    ConfirmationCompleted: () => Completed.make({}),
    ConfirmationRefused: (_, e) => Refused.make({ reason: e.reason }),
  },
}) {}

export class ConfirmWithClaim extends Domain.Saga("ConfirmWithClaim", {
  key: RequestId,
  input: { orderId: Schema.String, confirmationKey: Schema.String, claimId: Schema.String },
  rejects: [SalesOrderConfirmationIdempotencyConflict, SalesOrderNotFound, SalesOrderInvalidState],
}) {}

export const ConfirmWithClaimLive = ConfirmWithClaim.toLayer(
  Effect.gen(function* () {
    const orders = yield* SalesOrder
    const claims = yield* ConfirmationKeyClaim
    const requests = yield* ConfirmationRequest

    return Effect.fn(function* ({ key, orderId, confirmationKey, claimId }) {
      yield* Workflow.addFinalizer((exit) =>
        Exit.isFailure(exit)
          ? requests
              .send(key, new RefuseConfirmation({ reason: "rejected" }))
              .pipe(Effect.asVoid, Effect.orDie)
          : Effect.void,
      )

      const target = ClaimId.make(claimId)

      // Step 1: claim. The value says whether this run took the claim, so a retry by the holder
      // takes nothing and the compensation releases nothing.
      yield* Activity.make({
        name: "claim",
        success: Schema.Boolean,
        error: SalesOrderConfirmationIdempotencyConflict,
        execute: claims.send(target, new ClaimKey({ holder: orderId })).pipe(
          Effect.map((receipt) => receipt.events.length > 0),
          Effect.catchTag("ClaimHeld", () =>
            Effect.fail(new SalesOrderConfirmationIdempotencyConflict()),
          ),
        ),
      }).pipe(
        ConfirmWithClaim.withCompensation((taken) =>
          taken
            ? Activity.make({
                name: "release",
                execute: claims
                  .send(target, new ReleaseKey({ holder: orderId }))
                  .pipe(Effect.asVoid, Effect.orDie),
              })
            : Effect.void,
        ),
      )

      // Step 2: confirm on the order, whose own decider still answers Existing, a conflict, or
      // InvalidState exactly as in production.
      yield* Activity.make({
        name: "confirm",
        error: Schema.Union([
          SalesOrderNotFound,
          SalesOrderInvalidState,
          SalesOrderConfirmationIdempotencyConflict,
        ]),
        execute: orders
          .send(OrderId.make(orderId), new ConfirmOrder({ idempotencyKey: confirmationKey }))
          .pipe(Effect.asVoid),
      })

      yield* Activity.make({
        name: "complete",
        execute: requests.send(key, new CompleteConfirmation({})).pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

/** Starts the saga once the request is recorded. */
export class ConfirmationExecution extends Domain.Policy("ConfirmationExecution", {
  from: ConfirmationRequest,
  on: [ConfirmationRequested],
}) {}

export const ConfirmationExecutionLive = ConfirmationExecution.toLayer(
  Effect.gen(function* () {
    const runs = yield* ConfirmWithClaim

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(source, {
        orderId: event.orderId,
        confirmationKey: event.confirmationKey,
        claimId: event.claimId,
      })
    })
  }),
)

export class SalesConfirmationClaims extends Domain.Model("SalesConfirmationClaims", {
  aggregates: [SalesOrder, ConfirmationKeyClaim, ConfirmationRequest],
  policies: [ConfirmationExecution],
  sagas: [ConfirmWithClaim],
}) {}

export const SalesConfirmationClaimsHandlers = Layer.mergeAll(
  ConfirmWithClaimLive,
  ConfirmationExecutionLive,
)
