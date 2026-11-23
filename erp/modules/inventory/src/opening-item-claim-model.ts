/**
 * The claim protocol of ADR-0124 phase 3 for the second clause of `INV-OPEN-4`: an item already
 * opened in the warehouse fails with `OpeningStockAlreadyLoaded`. A load bundle spans many items
 * and one `OpeningLoad` instance cannot see another, so each item is claimed on its own aggregate
 * (`<tenant>/<warehouse>/<item>`, held by the `openingId`), one activity per line, and only then is
 * the load recorded by `AcceptOpening`. The shape follows `sales/src/confirmation-claim-model.ts`;
 * the per-line claim steps follow the per-line stock issues of the pilot delivery saga.
 *
 * - **Compensation releases only what this run took.** Each line's activity returns whether it took
 *   the claim, so a retry of the same load takes nothing, and a refused acceptance or a later
 *   line's refusal releases exactly the items this run claimed.
 * - **Order against production.** Production validates the bundle (approval, uncarried lines, a
 *   recorded load) before it looks for opened items; here the claims come first, so a bundle that
 *   is both invalid and overlapping reports the overlap. Either way nothing is left claimed.
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
  AcceptOpening,
  InTransitNotCarried,
  LotTrackingUnsupported,
  OpeningLoad,
  OpeningLoadId,
  OpeningStockConflict,
  ReservationsNotCarried,
  RevaluationApprovalMismatch,
} from "./domain-model.ts"

/** An item of the bundle is already opened in the warehouse (production: the same name). */
export class OpeningStockAlreadyLoaded extends Domain.Rejection("OpeningStockAlreadyLoaded", {
  warehouseId: Schema.String,
  itemId: Schema.String,
}) {}

// ---------------------------------------------------------------- the claim aggregate

/** `<tenant>/<warehouse>/<item>`: the tenant comes from the caller, never from the command. */
export const ClaimId = Schema.String.pipe(Schema.brand("OpeningItemClaimId"))

export class ClaimHeld extends Domain.Rejection("OpeningItemClaimHeld", {
  holder: Schema.String,
}) {}

export class ItemClaimed extends Domain.Event("OpeningItemClaimed", { holder: Schema.String }) {}

export class ItemReleased extends Domain.Event("OpeningItemReleased", { holder: Schema.String }) {}

export class ClaimItem extends Domain.Command("ClaimOpeningItem", {
  target: ClaimId,
  input: { holder: Schema.String },
  events: [ItemClaimed],
  rejects: [ClaimHeld],
}) {}

export class ReleaseItem extends Domain.Command("ReleaseOpeningItem", {
  target: ClaimId,
  input: { holder: Schema.String },
  events: [ItemReleased],
}) {}

const Free = Schema.TaggedStruct("Free", {})
const Held = Schema.TaggedStruct("Held", { holder: Schema.String })

export class OpeningItemClaim extends Domain.Aggregate("OpeningItemClaim", {
  id: ClaimId,
  state: Schema.Union([Free, Held]),
  initial: Free.make({}),
  commands: [ClaimItem, ReleaseItem],
  decide: {
    ClaimOpeningItem: (claim, cmd) => {
      if (!Predicate.isTagged(claim, "Held")) return [new ItemClaimed({ holder: cmd.holder })]

      return claim.holder === cmd.holder ? [] : new ClaimHeld({ holder: claim.holder })
    },
    ReleaseOpeningItem: (claim, cmd) =>
      Predicate.isTagged(claim, "Held") && claim.holder === cmd.holder
        ? [new ItemReleased({ holder: cmd.holder })]
        : [],
  },
  evolve: {
    OpeningItemClaimed: (_, e) => Held.make({ holder: e.holder }),
    OpeningItemReleased: () => Free.make({}),
  },
}) {}

// ---------------------------------------------------------------- the request and the saga

export const RequestId = Schema.String.pipe(Schema.brand("OpeningRequestId"))

/** The line of `AcceptOpening`, as that command takes it. */
const OpeningLine = Schema.Struct({
  itemId: Schema.String,
  quantity: Schema.String,
  sourceValue: Schema.String,
  movingAverageValue: Schema.optionalKey(Schema.String),
  tracking: Schema.Literals(["none", "lot", "expiry"]),
  reservedQuantity: Schema.String,
  inTransitQuantity: Schema.String,
})

const RequestInput = {
  tenant: Schema.String,
  openingId: Schema.String,
  warehouseId: Schema.String,
  cutoffDate: Schema.String,
  /** The owner who approved the revaluation, or null when the load carries no approval. */
  revaluationApprovedBy: Schema.NullOr(Schema.String),
  lines: Schema.Array(OpeningLine),
}

export class OpeningRequested extends Domain.Event("OpeningRequested", RequestInput) {}

export class OpeningRequestCompleted extends Domain.Event("OpeningRequestCompleted", {}) {}

export class OpeningRequestRefused extends Domain.Event("OpeningRequestRefused", {
  reason: Schema.String,
}) {}

export class RequestOpening extends Domain.Command("RequestOpening", {
  target: RequestId,
  input: RequestInput,
  events: [OpeningRequested],
}) {}

export class CompleteOpeningRequest extends Domain.Command("CompleteOpeningRequest", {
  target: RequestId,
  input: {},
  events: [OpeningRequestCompleted],
}) {}

export class RefuseOpeningRequest extends Domain.Command("RefuseOpeningRequest", {
  target: RequestId,
  input: { reason: Schema.String },
  events: [OpeningRequestRefused],
}) {}

const NoRequest = Schema.TaggedStruct("NoRequest", {})
const InProgress = Schema.TaggedStruct("InProgress", {})
const Completed = Schema.TaggedStruct("Completed", {})
const Refused = Schema.TaggedStruct("Refused", { reason: Schema.String })

export class OpeningRequest extends Domain.Aggregate("OpeningRequest", {
  id: RequestId,
  state: Schema.Union([NoRequest, InProgress, Completed, Refused]),
  initial: NoRequest.make({}),
  commands: [RequestOpening, CompleteOpeningRequest, RefuseOpeningRequest],
  decide: {
    RequestOpening: (s, cmd) =>
      Predicate.isTagged(s, "NoRequest")
        ? [
            new OpeningRequested({
              tenant: cmd.tenant,
              openingId: cmd.openingId,
              warehouseId: cmd.warehouseId,
              cutoffDate: cmd.cutoffDate,
              revaluationApprovedBy: cmd.revaluationApprovedBy,
              lines: cmd.lines,
            }),
          ]
        : [],
    CompleteOpeningRequest: (s) =>
      Predicate.isTagged(s, "InProgress") ? [new OpeningRequestCompleted()] : [],
    RefuseOpeningRequest: (s, cmd) =>
      Predicate.isTagged(s, "InProgress")
        ? [new OpeningRequestRefused({ reason: cmd.reason })]
        : [],
  },
  evolve: {
    OpeningRequested: () => InProgress.make({}),
    OpeningRequestCompleted: () => Completed.make({}),
    OpeningRequestRefused: (_, e) => Refused.make({ reason: e.reason }),
  },
}) {}

type Run = Schema.Struct<typeof RequestInput>["Type"] & { readonly key: typeof RequestId.Type }

/** The command carries the approval key only when the request states one. */
const acceptOpening = (
  run: Pick<Run, "warehouseId" | "cutoffDate" | "revaluationApprovedBy" | "lines">,
) =>
  run.revaluationApprovedBy === null
    ? new AcceptOpening({
        warehouseId: run.warehouseId,
        cutoffDate: run.cutoffDate,
        lines: run.lines,
      })
    : new AcceptOpening({
        warehouseId: run.warehouseId,
        cutoffDate: run.cutoffDate,
        revaluationApprovedBy: run.revaluationApprovedBy,
        lines: run.lines,
      })

export class OpenWithClaims extends Domain.Saga("OpenWithClaims", {
  key: RequestId,
  input: RequestInput,
  rejects: [
    OpeningStockAlreadyLoaded,
    RevaluationApprovalMismatch,
    LotTrackingUnsupported,
    ReservationsNotCarried,
    InTransitNotCarried,
    OpeningStockConflict,
  ],
}) {}

export const OpenWithClaimsLive = OpenWithClaims.toLayer(
  Effect.gen(function* () {
    const openings = yield* OpeningLoad
    const claims = yield* OpeningItemClaim
    const requests = yield* OpeningRequest

    return Effect.fn(function* ({
      key,
      tenant,
      openingId,
      warehouseId,
      cutoffDate,
      revaluationApprovedBy,
      lines,
    }: Run) {
      yield* Workflow.addFinalizer((exit) =>
        Exit.isFailure(exit)
          ? requests
              .send(key, new RefuseOpeningRequest({ reason: "rejected" }))
              .pipe(Effect.asVoid, Effect.orDie)
          : Effect.void,
      )

      // Step 1: one claim per line. Each activity says whether this run took its claim, so the
      // same load's retry takes nothing and each compensation releases only its own line.
      yield* Effect.forEach(
        lines,
        ({ itemId }) => {
          const target = ClaimId.make(`${tenant}/${warehouseId}/${itemId}`)

          return Activity.make({
            name: `claim:${itemId}`,
            success: Schema.Boolean,
            error: OpeningStockAlreadyLoaded,
            execute: claims.send(target, new ClaimItem({ holder: openingId })).pipe(
              Effect.map((receipt) => receipt.events.length > 0),
              Effect.catchTag("OpeningItemClaimHeld", () =>
                Effect.fail(new OpeningStockAlreadyLoaded({ warehouseId, itemId })),
              ),
            ),
          }).pipe(
            OpenWithClaims.withCompensation((taken) =>
              taken
                ? Activity.make({
                    name: `release:${itemId}`,
                    execute: claims
                      .send(target, new ReleaseItem({ holder: openingId }))
                      .pipe(Effect.asVoid, Effect.orDie),
                  })
                : Effect.void,
            ),
          )
        },
        { discard: true },
      )

      // Step 2: record the load on the aggregate, whose own decider still answers an invalid
      // bundle, a repeat, or a changed bundle exactly as in production.
      yield* Activity.make({
        name: "accept",
        error: Schema.Union([
          RevaluationApprovalMismatch,
          LotTrackingUnsupported,
          ReservationsNotCarried,
          InTransitNotCarried,
          OpeningStockConflict,
        ]),
        execute: openings
          .send(
            OpeningLoadId.make(openingId),
            acceptOpening({ warehouseId, cutoffDate, revaluationApprovedBy, lines }),
          )
          .pipe(Effect.asVoid),
      })

      yield* Activity.make({
        name: "complete",
        execute: requests
          .send(key, new CompleteOpeningRequest({}))
          .pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

/** Starts the saga once the request is recorded. */
export class OpeningExecution extends Domain.Policy("OpeningExecution", {
  from: OpeningRequest,
  on: [OpeningRequested],
}) {}

export const OpeningExecutionLive = OpeningExecution.toLayer(
  Effect.gen(function* () {
    const runs = yield* OpenWithClaims

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(source, {
        tenant: event.tenant,
        openingId: event.openingId,
        warehouseId: event.warehouseId,
        cutoffDate: event.cutoffDate,
        revaluationApprovedBy: event.revaluationApprovedBy,
        lines: event.lines,
      })
    })
  }),
)

export class InventoryOpeningClaims extends Domain.Model("InventoryOpeningClaims", {
  aggregates: [OpeningLoad, OpeningItemClaim, OpeningRequest],
  policies: [OpeningExecution],
  sagas: [OpenWithClaims],
}) {}

export const InventoryOpeningClaimsHandlers = Layer.mergeAll(
  OpenWithClaimsLive,
  OpeningExecutionLive,
)
