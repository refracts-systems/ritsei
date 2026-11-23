/**
 * The claim protocol of ADR-0124 phase 3 for the stock correction key (`INV-STOCK-3`): a key must
 * not be reused for different stock anywhere in the tenant. One `StockItem` instance cannot see
 * another, so the key is claimed on its own aggregate first (held by the stock item instance id),
 * and only then recorded by `CorrectStock`. The shape and the reasoning are those of
 * `sales/src/confirmation-claim-model.ts`; the rules that differ are:
 *
 * - **The rejection.** A key held by another stock item is `CorrectionKeyReused`, the model's
 *   analog of production's `StockCorrectionIdempotencyConflict` (the model carries no tenant id).
 * - **Same stock item, other content.** The claim is the holder's, so the claim step takes nothing
 *   and `CorrectStock` answers `CorrectionKeyReused` itself; the claim stays, as the item carries
 *   the key.
 *
 * Test-only: not exported from `mod.ts`.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { Activity, Workflow } from "effect/workflow"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  CorrectionKeyReused,
  CorrectStock,
  StockItem,
  StockItemId,
  StockUnavailable,
  UnitOfMeasureMismatch,
} from "./domain-model.ts"

// ---------------------------------------------------------------- the claim aggregate

/** `<tenant>/<idempotency key>`: the tenant comes from the caller, never from the command. */
export const ClaimId = Schema.String.pipe(Schema.brand("CorrectionKeyClaimId"))

export class ClaimHeld extends Domain.Rejection("CorrectionClaimHeld", { holder: Schema.String }) {}

export class KeyClaimed extends Domain.Event("CorrectionKeyClaimed", { holder: Schema.String }) {}

export class KeyReleased extends Domain.Event("CorrectionKeyReleased", { holder: Schema.String }) {}

export class ClaimKey extends Domain.Command("ClaimCorrectionKey", {
  target: ClaimId,
  input: { holder: Schema.String },
  events: [KeyClaimed],
  rejects: [ClaimHeld],
}) {}

export class ReleaseKey extends Domain.Command("ReleaseCorrectionKey", {
  target: ClaimId,
  input: { holder: Schema.String },
  events: [KeyReleased],
}) {}

const Free = Schema.TaggedStruct("Free", {})
const Held = Schema.TaggedStruct("Held", { holder: Schema.String })

export class CorrectionKeyClaim extends Domain.Aggregate("CorrectionKeyClaim", {
  id: ClaimId,
  state: Schema.Union([Free, Held]),
  initial: Free.make({}),
  commands: [ClaimKey, ReleaseKey],
  decide: {
    ClaimCorrectionKey: (claim, cmd) => {
      if (!Predicate.isTagged(claim, "Held")) return [new KeyClaimed({ holder: cmd.holder })]

      return claim.holder === cmd.holder ? [] : new ClaimHeld({ holder: claim.holder })
    },
    ReleaseCorrectionKey: (claim, cmd) =>
      Predicate.isTagged(claim, "Held") && claim.holder === cmd.holder
        ? [new KeyReleased({ holder: cmd.holder })]
        : [],
  },
  evolve: {
    CorrectionKeyClaimed: (_, e) => Held.make({ holder: e.holder }),
    CorrectionKeyReleased: () => Free.make({}),
  },
}) {}

// ---------------------------------------------------------------- the request and the saga

export const RequestId = Schema.String.pipe(Schema.brand("CorrectionRequestId"))

const RequestInput = {
  stockItemId: Schema.String,
  claimId: Schema.String,
  idempotencyKey: Schema.String,
  adjustment: Schema.BigInt,
  unitOfMeasure: Schema.String,
  reason: Schema.String,
  itemUnitOfMeasure: Schema.String,
}

export class CorrectionRequested extends Domain.Event("CorrectionRequested", RequestInput) {}

export class CorrectionCompleted extends Domain.Event("CorrectionCompleted", {}) {}

export class CorrectionRefused extends Domain.Event("CorrectionRefused", {
  reason: Schema.String,
}) {}

export class RequestCorrection extends Domain.Command("RequestCorrection", {
  target: RequestId,
  input: RequestInput,
  events: [CorrectionRequested],
}) {}

export class CompleteCorrection extends Domain.Command("CompleteCorrection", {
  target: RequestId,
  input: {},
  events: [CorrectionCompleted],
}) {}

export class RefuseCorrection extends Domain.Command("RefuseCorrection", {
  target: RequestId,
  input: { reason: Schema.String },
  events: [CorrectionRefused],
}) {}

const NoRequest = Schema.TaggedStruct("NoRequest", {})
const InProgress = Schema.TaggedStruct("InProgress", {})
const Completed = Schema.TaggedStruct("Completed", {})
const Refused = Schema.TaggedStruct("Refused", { reason: Schema.String })

export class CorrectionRequest extends Domain.Aggregate("CorrectionRequest", {
  id: RequestId,
  state: Schema.Union([NoRequest, InProgress, Completed, Refused]),
  initial: NoRequest.make({}),
  commands: [RequestCorrection, CompleteCorrection, RefuseCorrection],
  decide: {
    RequestCorrection: (s, cmd) =>
      Predicate.isTagged(s, "NoRequest")
        ? [
            new CorrectionRequested({
              stockItemId: cmd.stockItemId,
              claimId: cmd.claimId,
              idempotencyKey: cmd.idempotencyKey,
              adjustment: cmd.adjustment,
              unitOfMeasure: cmd.unitOfMeasure,
              reason: cmd.reason,
              itemUnitOfMeasure: cmd.itemUnitOfMeasure,
            }),
          ]
        : [],
    CompleteCorrection: (s) =>
      Predicate.isTagged(s, "InProgress") ? [new CorrectionCompleted()] : [],
    RefuseCorrection: (s, cmd) =>
      Predicate.isTagged(s, "InProgress") ? [new CorrectionRefused({ reason: cmd.reason })] : [],
  },
  evolve: {
    CorrectionRequested: () => InProgress.make({}),
    CorrectionCompleted: () => Completed.make({}),
    CorrectionRefused: (_, e) => Refused.make({ reason: e.reason }),
  },
}) {}

export class CorrectWithClaim extends Domain.Saga("CorrectWithClaim", {
  key: RequestId,
  input: RequestInput,
  rejects: [CorrectionKeyReused, UnitOfMeasureMismatch, StockUnavailable],
}) {}

export const CorrectWithClaimLive = CorrectWithClaim.toLayer(
  Effect.gen(function* () {
    const items = yield* StockItem
    const claims = yield* CorrectionKeyClaim
    const requests = yield* CorrectionRequest

    return Effect.fn(function* ({
      key,
      stockItemId,
      claimId,
      idempotencyKey,
      adjustment,
      unitOfMeasure,
      reason,
      itemUnitOfMeasure,
    }) {
      yield* Workflow.addFinalizer((exit) =>
        Exit.isFailure(exit)
          ? requests
              .send(key, new RefuseCorrection({ reason: "rejected" }))
              .pipe(Effect.asVoid, Effect.orDie)
          : Effect.void,
      )

      const target = ClaimId.make(claimId)

      // Step 1: claim. The value says whether this run took the claim, so the holder's retry takes
      // nothing and the compensation releases nothing.
      yield* Activity.make({
        name: "claim",
        success: Schema.Boolean,
        error: CorrectionKeyReused,
        execute: claims.send(target, new ClaimKey({ holder: stockItemId })).pipe(
          Effect.map((receipt) => receipt.events.length > 0),
          Effect.catchTag("CorrectionClaimHeld", () =>
            Effect.fail(new CorrectionKeyReused({ idempotencyKey })),
          ),
        ),
      }).pipe(
        CorrectWithClaim.withCompensation((taken) =>
          taken
            ? Activity.make({
                name: "release",
                execute: claims
                  .send(target, new ReleaseKey({ holder: stockItemId }))
                  .pipe(Effect.asVoid, Effect.orDie),
              })
            : Effect.void,
        ),
      )

      // Step 2: record on the stock item, whose own decider still answers a repeat, a changed
      // request, a unit mismatch, or an unavailable balance exactly as in production.
      yield* Activity.make({
        name: "correct",
        error: Schema.Union([CorrectionKeyReused, UnitOfMeasureMismatch, StockUnavailable]),
        execute: items
          .send(
            StockItemId.make(stockItemId),
            new CorrectStock({
              idempotencyKey,
              adjustment,
              unitOfMeasure,
              reason,
              itemUnitOfMeasure,
            }),
          )
          .pipe(Effect.asVoid),
      })

      yield* Activity.make({
        name: "complete",
        execute: requests.send(key, new CompleteCorrection({})).pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

/** Starts the saga once the request is recorded. */
export class CorrectionExecution extends Domain.Policy("CorrectionExecution", {
  from: CorrectionRequest,
  on: [CorrectionRequested],
}) {}

export const CorrectionExecutionLive = CorrectionExecution.toLayer(
  Effect.gen(function* () {
    const runs = yield* CorrectWithClaim

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(source, {
        stockItemId: event.stockItemId,
        claimId: event.claimId,
        idempotencyKey: event.idempotencyKey,
        adjustment: event.adjustment,
        unitOfMeasure: event.unitOfMeasure,
        reason: event.reason,
        itemUnitOfMeasure: event.itemUnitOfMeasure,
      })
    })
  }),
)

export class InventoryCorrectionClaims extends Domain.Model("InventoryCorrectionClaims", {
  aggregates: [StockItem, CorrectionKeyClaim, CorrectionRequest],
  policies: [CorrectionExecution],
  sagas: [CorrectWithClaim],
}) {}

export const InventoryCorrectionClaimsHandlers = Layer.mergeAll(
  CorrectWithClaimLive,
  CorrectionExecutionLive,
)
