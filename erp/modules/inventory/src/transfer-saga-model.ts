/**
 * Stock transfers staged for ADR-0124 phase 5 (`INV-XFER-1`). Production confirms a transfer by
 * checking every source line and deducting all of them in one transaction, so one unavailable line
 * deducts nothing, and completes it by adding every destination line in another. On the Effect
 * Cluster host each stock position is its own aggregate and commits on its own pool, so each of the
 * two steps becomes a saga over the lines. This model states that staging and nothing else; there
 * is no cutover, and the rule stays on its PostgreSQL transaction until the owner decides
 * otherwise.
 *
 * - **Confirmation is a saga with compensation.** The transfer moves from `Draft` to `Confirming`,
 *   each source line is deducted in item order, and the transfer becomes `Confirmed`. A line that
 *   is not available refuses the confirmation: the deductions made before it are restored, the
 *   transfer returns to `Draft`, and the refusal is recorded, so the caller's answer
 *   (`StockUnavailable`, in the saga's outcome) is the production one but the stock saw a deduction and its restoration.
 * - **A half-applied transfer is visible.** While the saga runs the transfer is `Confirming` and
 *   some positions are already deducted; nothing reads it as confirmed until every line is.
 * - **Compensations never refuse.** A restoration only adds stock back and is idempotent per
 *   transfer; so is a deduction and a destination receipt.
 * - **Completion cannot be refused.** Adding stock has no precondition, so its saga has no
 *   compensation and completes the transfer after the last line.
 * - **Repeats are no-ops.** Confirming a transfer that is not a draft, or completing one that is
 *   completing or completed, records nothing; completing one that is not confirmed is refused.
 *
 * Not modelled: reservations of stock (they are only a number on the position), costs, the two
 * capabilities, warehouses of the same legal entity, and who is told of a refusal. Test-only: not
 * exported from `mod.ts`.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { Activity, Workflow } from "effect/workflow"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { hasAvailableStock } from "./stock-rules.ts"

// ---------------------------------------------------------------- the stock position

/** `<warehouse>/<item>`. */
export const PositionId = Schema.String.pipe(Schema.brand("TransferPositionId"))

export class StockUnavailable extends Domain.Rejection("TransferStockUnavailable", {
  itemId: Schema.String,
}) {}

export class PositionSeeded extends Domain.Event("TransferPositionSeeded", {
  onHand: Schema.String,
  reserved: Schema.String,
}) {}

export class TransferDeducted extends Domain.Event("TransferDeducted", {
  transferId: Schema.String,
  quantity: Schema.String,
  onHandAfter: Schema.String,
}) {}

export class DeductionRestored extends Domain.Event("TransferDeductionRestored", {
  transferId: Schema.String,
  quantity: Schema.String,
  onHandAfter: Schema.String,
}) {}

export class TransferReceived extends Domain.Event("TransferReceived", {
  transferId: Schema.String,
  quantity: Schema.String,
  onHandAfter: Schema.String,
}) {}

export class SeedPosition extends Domain.Command("SeedTransferPosition", {
  target: PositionId,
  input: { onHand: Schema.String, reserved: Schema.String },
  events: [PositionSeeded],
}) {}

export class DeductForTransfer extends Domain.Command("DeductForTransfer", {
  target: PositionId,
  input: { transferId: Schema.String, itemId: Schema.String, quantity: Schema.String },
  events: [TransferDeducted],
  rejects: [StockUnavailable],
}) {}

export class RestoreDeduction extends Domain.Command("RestoreTransferDeduction", {
  target: PositionId,
  input: { transferId: Schema.String },
  events: [DeductionRestored],
}) {}

export class ReceiveForTransfer extends Domain.Command("ReceiveForTransfer", {
  target: PositionId,
  input: { transferId: Schema.String, quantity: Schema.String },
  events: [TransferReceived],
}) {}

const Position = Schema.Struct({
  onHand: Schema.String,
  reserved: Schema.String,
  /** What each transfer deducted here, and which transfers delivered here. */
  deducted: Schema.Record(Schema.String, Schema.String),
  received: Schema.Array(Schema.String),
})

export class TransferPosition extends Domain.Aggregate("TransferPosition", {
  id: PositionId,
  state: Position,
  initial: { onHand: "0", reserved: "0", deducted: {}, received: [] },
  commands: [SeedPosition, DeductForTransfer, RestoreDeduction, ReceiveForTransfer],
  decide: {
    SeedTransferPosition: (s, cmd) =>
      s.onHand === "0" ? [new PositionSeeded({ onHand: cmd.onHand, reserved: cmd.reserved })] : [],
    DeductForTransfer: (s, cmd) => {
      if (s.deducted[cmd.transferId] !== undefined) return []

      const quantity = BigInt(cmd.quantity)

      if (
        !hasAvailableStock({ onHand: BigInt(s.onHand), reserved: BigInt(s.reserved) }, quantity)
      ) {
        return new StockUnavailable({ itemId: cmd.itemId })
      }

      return [
        new TransferDeducted({
          transferId: cmd.transferId,
          quantity: cmd.quantity,
          onHandAfter: String(BigInt(s.onHand) - quantity),
        }),
      ]
    },
    RestoreTransferDeduction: (s, cmd) => {
      const taken = s.deducted[cmd.transferId]

      return taken === undefined
        ? []
        : [
            new DeductionRestored({
              transferId: cmd.transferId,
              quantity: taken,
              onHandAfter: String(BigInt(s.onHand) + BigInt(taken)),
            }),
          ]
    },
    ReceiveForTransfer: (s, cmd) =>
      s.received.includes(cmd.transferId)
        ? []
        : [
            new TransferReceived({
              transferId: cmd.transferId,
              quantity: cmd.quantity,
              onHandAfter: String(BigInt(s.onHand) + BigInt(cmd.quantity)),
            }),
          ],
  },
  evolve: {
    TransferPositionSeeded: (s, e) => ({ ...s, onHand: e.onHand, reserved: e.reserved }),
    TransferDeducted: (s, e) => ({
      ...s,
      onHand: e.onHandAfter,
      deducted: { ...s.deducted, [e.transferId]: e.quantity },
    }),
    TransferDeductionRestored: (s, e) => ({
      ...s,
      onHand: e.onHandAfter,
      deducted: Object.fromEntries(
        Object.entries(s.deducted).filter(([id]) => id !== e.transferId),
      ),
    }),
    TransferReceived: (s, e) => ({
      ...s,
      onHand: e.onHandAfter,
      received: [...s.received, e.transferId],
    }),
  },
}) {}

// ---------------------------------------------------------------- the transfer

export const TransferId = Schema.String.pipe(Schema.brand("StagedTransferId"))

export class TransferInvalidState extends Domain.Rejection("TransferInvalidState", {
  status: Schema.String,
}) {}

export class TransferNotFound extends Domain.Rejection("TransferNotFound") {}

const Line = Schema.Struct({ itemId: Schema.String, quantity: Schema.String })

const Route = {
  sourceWarehouseId: Schema.String,
  destinationWarehouseId: Schema.String,
  lines: Schema.Array(Line),
}

export class TransferCreated extends Domain.Event("StagedTransferCreated", Route) {}

export class ConfirmationRequested extends Domain.Event("TransferConfirmationRequested", {
  ...Route,
  /** Which try this is: a retry after a refusal runs its own saga. */
  attempt: Schema.Int,
}) {}

export class TransferConfirmed extends Domain.Event("StagedTransferConfirmed", {}) {}

/** The confirmation stopped at a line that was not available; the deductions were restored. */
export class ConfirmationRefused extends Domain.Event("TransferConfirmationRefused", {}) {}

export class CompletionRequested extends Domain.Event("TransferCompletionRequested", Route) {}

export class TransferCompleted extends Domain.Event("StagedTransferCompleted", {}) {}

export class CreateTransfer extends Domain.Command("CreateStagedTransfer", {
  target: TransferId,
  input: Route,
  events: [TransferCreated],
}) {}

export class ConfirmTransferRequest extends Domain.Command("RequestTransferConfirmation", {
  target: TransferId,
  input: {},
  events: [ConfirmationRequested],
  rejects: [TransferNotFound],
}) {}

export class MarkConfirmed extends Domain.Command("MarkTransferConfirmed", {
  target: TransferId,
  input: {},
  events: [TransferConfirmed],
}) {}

export class RefuseConfirmation extends Domain.Command("RefuseTransferConfirmation", {
  target: TransferId,
  input: {},
  events: [ConfirmationRefused],
}) {}

export class CompleteTransferRequest extends Domain.Command("RequestTransferCompletion", {
  target: TransferId,
  input: {},
  events: [CompletionRequested],
  rejects: [TransferNotFound, TransferInvalidState],
}) {}

export class MarkCompleted extends Domain.Command("MarkTransferCompleted", {
  target: TransferId,
  input: {},
  events: [TransferCompleted],
}) {}

type RouteOf = Schema.Struct<typeof Route>["Type"]

/** The route and lines of a state or event, without its tag. */
const routeOf = ({ sourceWarehouseId, destinationWarehouseId, lines }: RouteOf): RouteOf => ({
  sourceWarehouseId,
  destinationWarehouseId,
  lines,
})

const Absent = Schema.TaggedStruct("Absent", {})
const Draft = Schema.TaggedStruct("Draft", { ...Route, attempts: Schema.Int })
const Confirming = Schema.TaggedStruct("Confirming", { ...Route, attempt: Schema.Int })
const Confirmed = Schema.TaggedStruct("Confirmed", Route)
const Completing = Schema.TaggedStruct("Completing", Route)
const Completed = Schema.TaggedStruct("Completed", {})

export class StagedTransfer extends Domain.Aggregate("StagedTransfer", {
  id: TransferId,
  state: Schema.Union([Absent, Draft, Confirming, Confirmed, Completing, Completed]),
  initial: Absent.make({}),
  commands: [
    CreateTransfer,
    ConfirmTransferRequest,
    MarkConfirmed,
    RefuseConfirmation,
    CompleteTransferRequest,
    MarkCompleted,
  ],
  decide: {
    CreateStagedTransfer: (s, cmd) =>
      Predicate.isTagged(s, "Absent")
        ? [
            new TransferCreated({
              sourceWarehouseId: cmd.sourceWarehouseId,
              destinationWarehouseId: cmd.destinationWarehouseId,
              lines: cmd.lines,
            }),
          ]
        : [],
    RequestTransferConfirmation: (s) => {
      if (Predicate.isTagged(s, "Absent")) return new TransferNotFound()

      // Only a draft confirms; any other state returns the transfer as it is.
      return Predicate.isTagged(s, "Draft")
        ? [
            new ConfirmationRequested({
              sourceWarehouseId: s.sourceWarehouseId,
              destinationWarehouseId: s.destinationWarehouseId,
              lines: s.lines,
              attempt: s.attempts + 1,
            }),
          ]
        : []
    },
    MarkTransferConfirmed: (s) =>
      Predicate.isTagged(s, "Confirming") ? [new TransferConfirmed()] : [],
    RefuseTransferConfirmation: (s) =>
      Predicate.isTagged(s, "Confirming") ? [new ConfirmationRefused()] : [],
    RequestTransferCompletion: (s) => {
      if (Predicate.isTagged(s, "Absent")) return new TransferNotFound()

      if (Predicate.isTagged(s, "Confirmed")) {
        return [
          new CompletionRequested({
            sourceWarehouseId: s.sourceWarehouseId,
            destinationWarehouseId: s.destinationWarehouseId,
            lines: s.lines,
          }),
        ]
      }

      if (Predicate.isTagged(s, "Completing") || Predicate.isTagged(s, "Completed")) return []

      return new TransferInvalidState({
        status: Predicate.isTagged(s, "Draft") ? "draft" : "confirming",
      })
    },
    MarkTransferCompleted: (s) =>
      Predicate.isTagged(s, "Completing") ? [new TransferCompleted()] : [],
  },
  evolve: {
    StagedTransferCreated: (_, e) => Draft.make({ ...routeOf(e), attempts: 0 }),
    TransferConfirmationRequested: (_, e) => Confirming.make({ ...routeOf(e), attempt: e.attempt }),
    StagedTransferConfirmed: (s) =>
      Predicate.isTagged(s, "Confirming") ? Confirmed.make(routeOf(s)) : s,
    TransferConfirmationRefused: (s) =>
      Predicate.isTagged(s, "Confirming") ? Draft.make({ ...routeOf(s), attempts: s.attempt }) : s,
    TransferCompletionRequested: (_, e) => Completing.make(routeOf(e)),
    StagedTransferCompleted: () => Completed.make({}),
  },
}) {}

// ---------------------------------------------------------------- one confirmation attempt

/** `<transfer>/<attempt>`: a confirmation retried after a refusal is a new run, not a repeat. */
export const AttemptId = Schema.String.pipe(Schema.brand("TransferAttemptId"))

export const attemptId = (transferId: string, attempt: number) =>
  AttemptId.make(`${transferId}/${attempt}`)

export class AttemptFinished extends Domain.Event("TransferAttemptFinished", {}) {}

export class FinishAttempt extends Domain.Command("FinishTransferAttempt", {
  target: AttemptId,
  input: {},
  events: [AttemptFinished],
}) {}

const Running = Schema.TaggedStruct("Running", {})
const Finished = Schema.TaggedStruct("Finished", {})

export class ConfirmAttempt extends Domain.Aggregate("ConfirmAttempt", {
  id: AttemptId,
  state: Schema.Union([Running, Finished]),
  initial: Running.make({}),
  commands: [FinishAttempt],
  decide: {
    FinishTransferAttempt: (s) => (Predicate.isTagged(s, "Running") ? [new AttemptFinished()] : []),
  },
  evolve: {
    TransferAttemptFinished: () => Finished.make({}),
  },
}) {}

// ---------------------------------------------------------------- the sagas

const RunInput = Route

type Run = Schema.Struct<typeof RunInput>["Type"] & { readonly key: typeof TransferId.Type }

const ConfirmInput = { transferId: Schema.String, ...Route }

type ConfirmRun = Schema.Struct<typeof ConfirmInput>["Type"] & {
  readonly key: typeof AttemptId.Type
}

export class ConfirmTransfer extends Domain.Saga("ConfirmTransfer", {
  key: AttemptId,
  input: ConfirmInput,
  rejects: [StockUnavailable],
}) {}

export class ReceiveTransfer extends Domain.Saga("ReceiveTransfer", {
  key: TransferId,
  input: RunInput,
}) {}

const byItem = (lines: Run["lines"]) =>
  lines.toSorted((left, right) => left.itemId.localeCompare(right.itemId))

export const ConfirmTransferLive = ConfirmTransfer.toLayer(
  Effect.gen(function* () {
    const positions = yield* TransferPosition
    const transfers = yield* StagedTransfer
    const attempts = yield* ConfirmAttempt

    return Effect.fn(function* ({ key, transferId, sourceWarehouseId, lines }: ConfirmRun) {
      // A refused line is recorded on the transfer after the compensations ran.
      yield* Workflow.addFinalizer((exit) =>
        Exit.isFailure(exit)
          ? transfers
              .send(TransferId.make(transferId), new RefuseConfirmation({}))
              .pipe(Effect.asVoid, Effect.orDie)
          : Effect.void,
      )

      yield* Effect.forEach(
        byItem(lines),
        ({ itemId, quantity }) => {
          const target = PositionId.make(`${sourceWarehouseId}/${itemId}`)

          return Activity.make({
            name: `deduct:${itemId}`,
            success: Schema.Boolean,
            error: StockUnavailable,
            execute: positions
              .send(target, new DeductForTransfer({ transferId, itemId, quantity }))
              .pipe(Effect.map((receipt) => receipt.events.length > 0)),
          }).pipe(
            ConfirmTransfer.withCompensation((taken) =>
              taken
                ? Activity.make({
                    name: `restore:${itemId}`,
                    execute: positions
                      .send(target, new RestoreDeduction({ transferId }))
                      .pipe(Effect.asVoid, Effect.orDie),
                  })
                : Effect.void,
            ),
          )
        },
        { discard: true },
      )

      yield* Activity.make({
        name: "confirmed",
        execute: transfers
          .send(TransferId.make(transferId), new MarkConfirmed({}))
          .pipe(Effect.asVoid, Effect.orDie),
      })

      yield* Activity.make({
        name: "finished",
        execute: attempts.send(key, new FinishAttempt({})).pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

export const ReceiveTransferLive = ReceiveTransfer.toLayer(
  Effect.gen(function* () {
    const positions = yield* TransferPosition
    const transfers = yield* StagedTransfer

    return Effect.fn(function* ({ key, destinationWarehouseId, lines }: Run) {
      yield* Effect.forEach(
        byItem(lines),
        ({ itemId, quantity }) =>
          Activity.make({
            name: `receive:${itemId}`,
            execute: positions
              .send(
                PositionId.make(`${destinationWarehouseId}/${itemId}`),
                new ReceiveForTransfer({ transferId: key, quantity }),
              )
              .pipe(Effect.asVoid, Effect.orDie),
          }),
        { discard: true },
      )

      yield* Activity.make({
        name: "completed",
        execute: transfers.send(key, new MarkCompleted({})).pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

/** Starts the confirmation once it is requested. */
export class ConfirmationStart extends Domain.Policy("ConfirmationStart", {
  from: StagedTransfer,
  on: [ConfirmationRequested],
}) {}

export const ConfirmationStartLive = ConfirmationStart.toLayer(
  Effect.gen(function* () {
    const runs = yield* ConfirmTransfer

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(attemptId(source.id, event.attempt), {
        transferId: source.id,
        sourceWarehouseId: event.sourceWarehouseId,
        destinationWarehouseId: event.destinationWarehouseId,
        lines: event.lines,
      })
    })
  }),
)

/** Starts the completion once it is requested. */
export class CompletionStart extends Domain.Policy("CompletionStart", {
  from: StagedTransfer,
  on: [CompletionRequested],
}) {}

export const CompletionStartLive = CompletionStart.toLayer(
  Effect.gen(function* () {
    const runs = yield* ReceiveTransfer

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(source, {
        sourceWarehouseId: event.sourceWarehouseId,
        destinationWarehouseId: event.destinationWarehouseId,
        lines: event.lines,
      })
    })
  }),
)

export class InventoryTransfers extends Domain.Model("InventoryTransfers", {
  aggregates: [StagedTransfer, TransferPosition, ConfirmAttempt],
  policies: [ConfirmationStart, CompletionStart],
  sagas: [ConfirmTransfer, ReceiveTransfer],
}) {}

export const InventoryTransfersHandlers = Layer.mergeAll(
  ConfirmTransferLive,
  ReceiveTransferLive,
  ConfirmationStartLive,
  CompletionStartLive,
)
