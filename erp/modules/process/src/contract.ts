import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Match from "effect/Match"

import { DatabaseFailure, LeaseGeneration } from "../../../../framework/foundation/mod.ts"
import {
  AccountingPeriodNotOpen,
  FinancialEngineActivated,
  JournalEntry,
  JournalIdempotencyConflict,
  RevenueJournalNotFound,
  RevenuePostingProfileNotFound,
} from "../../accounting/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import {
  StockReservation,
  StockReservationIdempotencyConflict,
  StockReservationInvalidState,
  StockReservationLegalEntityMismatch,
  StockReservationNotFound,
  StockUnavailable,
} from "../../inventory/mod.ts"
import {
  EventEnvelope,
  EventIdempotencyConflict,
} from "../../../../framework/modules/messaging/mod.ts"
import {
  SalesOrder,
  SalesOrderConfirmationIdempotencyConflict,
  SalesOrderInvalidState,
  SalesOrderNotFound,
} from "../../sales/mod.ts"
import {
  OrderConfirmationCorrupt,
  OrderConfirmationNotFound,
  ProcessJobCorrupt,
  ProcessJobLeaseLost,
  ProcessJobNotFound,
  WorkflowAlreadyCompleted,
  WorkflowAlreadyInProgress,
  WorkflowIdempotencyConflict,
  WorkflowManualRecoveryRequired,
  WorkflowOutcomeUnknown,
  WorkflowResultCorrupt,
  WorkflowRunNotFound,
} from "./errors.ts"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))

const PostgresInt = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(-2_147_483_648),
  Schema.isLessThanOrEqualTo(2_147_483_647),
)

const NonNegativeInt = PostgresInt.check(Schema.isGreaterThanOrEqualTo(0))
const Uuid = EventEnvelope.fields.eventId
const InstantString = EventEnvelope.fields.occurredAt

export const ProcessWorkflowTypes = {
  confirmation: "sales.order.confirmation",
  cancellation: "sales.order.cancellation",
  fulfillment: "sales.order.fulfillment",
} as const

export const ProcessWorkflowType = Schema.Literals([
  ProcessWorkflowTypes.confirmation,
  ProcessWorkflowTypes.cancellation,
  ProcessWorkflowTypes.fulfillment,
])

export const ProcessLifecycleJobPriority = 100
export const ProcessJobMaxAttempts = 3

export const ProcessPostCommitJobTypes = {
  confirmation: "process.order_confirmation.post_commit",
  cancellation: "process.order_cancellation.post_commit",
  fulfillment: "process.order_fulfillment.post_commit",
} as const

export const ProcessPostCommitJobType = Schema.Literals([
  ProcessPostCommitJobTypes.confirmation,
  ProcessPostCommitJobTypes.cancellation,
  ProcessPostCommitJobTypes.fulfillment,
])

export const ProcessFinancialJobTypes = {
  submit: "accounting.financial_operation.submit",
  reconcile: "accounting.financial_operation.reconcile",
} as const

export const ProcessFinancialJobType = Schema.Literals([
  ProcessFinancialJobTypes.submit,
  ProcessFinancialJobTypes.reconcile,
])

export const ProcessJobType = Schema.Literals([
  ProcessPostCommitJobTypes.confirmation,
  ProcessPostCommitJobTypes.cancellation,
  ProcessPostCommitJobTypes.fulfillment,
  ProcessFinancialJobTypes.submit,
  ProcessFinancialJobTypes.reconcile,
])

export const OrderConfirmationPayload = Schema.Struct({
  orderId: Uuid,
  warehouseId: Uuid,
  legalEntityId: Uuid,
  commandId: NonEmptyString,
  correlationId: NonEmptyString,
  causationId: Schema.NullOr(NonEmptyString).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  idempotencyKey: NonEmptyString,
})

const ScopedInput = {
  principal: Principal,
  tenantId: Uuid,
}

export const ConfirmOrderConfirmationInput = Schema.Struct({
  ...ScopedInput,
  ...OrderConfirmationPayload.fields,
})

export const RecoverOrderConfirmationInput = ConfirmOrderConfirmationInput

const OrderLifecyclePayloadFields = {
  orderId: Uuid,
  commandId: NonEmptyString,
  correlationId: NonEmptyString,
  causationId: Schema.NullOr(NonEmptyString).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  idempotencyKey: NonEmptyString,
}

export const OrderCancellationPayload = Schema.Struct(OrderLifecyclePayloadFields)

export const CancelOrderInput = Schema.Struct({
  ...ScopedInput,
  ...OrderCancellationPayload.fields,
})

export const OrderFulfillmentPayload = Schema.Struct(OrderLifecyclePayloadFields)

export const FulfillOrderInput = Schema.Struct({
  ...ScopedInput,
  ...OrderFulfillmentPayload.fields,
})

export const ManualRecoveryInput = Schema.Struct({
  ...ScopedInput,
  idempotencyKey: NonEmptyString,
  reason: NonEmptyString,
})

export const DomainEventEnvelope = EventEnvelope

export const ProcessPostCommitJobPayload = Schema.Struct({
  eventId: Uuid,
  workflowRunId: Uuid,
  commandId: NonEmptyString,
  correlationId: NonEmptyString,
  causationId: Schema.NullOr(NonEmptyString),
  idempotencyKey: NonEmptyString,
})

export const ProcessJobStatus = Schema.Literals([
  "pending",
  "leased",
  "completed",
  "failed",
  "manual_recovery",
])

export const ProcessJob = Schema.Struct({
  jobId: Uuid,
  tenantId: Uuid,
  fenceScope: NonEmptyString,
  leaseGeneration: LeaseGeneration,
  jobType: ProcessJobType,
  idempotencyKey: NonEmptyString,
  priority: PostgresInt,
  status: ProcessJobStatus,
  scheduledAt: InstantString,
  leaseUntil: Schema.NullOr(InstantString),
  leaseOwner: Schema.NullOr(NonEmptyString).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  leaseToken: Schema.NullOr(Uuid).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  attempts: NonNegativeInt,
  payload: Schema.Json,
  correlationId: NonEmptyString,
}).check(
  Schema.makeFilter(
    (job) =>
      job.status === "leased"
        ? job.leaseUntil !== null && job.leaseOwner !== null && job.leaseToken !== null
        : job.leaseUntil === null && job.leaseOwner === null && job.leaseToken === null,
    { expected: "job lease metadata consistent with its durable state" },
  ),
)

export const ProcessJobClaimInput = Schema.Struct({
  tenantId: Uuid,
  workerId: NonEmptyString,
  jobType: Schema.NullOr(ProcessJobType).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
})

export const ProcessJobRenewInput = Schema.Struct({
  tenantId: Uuid,
  workerId: NonEmptyString,
  jobId: Uuid,
  leaseToken: Uuid,
  leaseGeneration: LeaseGeneration,
})

export const ProcessJobCompleteInput = ProcessJobRenewInput

export const ProcessJobFailInput = Schema.Struct({
  tenantId: Uuid,
  workerId: NonEmptyString,
  jobId: Uuid,
  leaseToken: Uuid,
  leaseGeneration: LeaseGeneration,
  error: NonEmptyString,
  retryAt: Schema.NullOr(InstantString).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
})

export const WorkflowRun = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  workflowType: ProcessWorkflowType,
  idempotencyKey: NonEmptyString,
  aggregateId: Uuid,
  status: Schema.Literals(["running", "succeeded", "manual_recovery"]),
  recoveryReason: Schema.NullOr(NonEmptyString),
  completedAt: Schema.NullOr(InstantString),
}).check(
  Schema.makeFilter(
    (run) =>
      Match.value(run.status).pipe(
        Match.when("running", () => run.completedAt === null && run.recoveryReason === null),
        Match.when("succeeded", () => run.completedAt !== null && run.recoveryReason === null),
        Match.orElse(() => run.completedAt === null && run.recoveryReason !== null),
      ),
    { expected: "workflow status metadata consistent with its durable state" },
  ),
)

export const OrderConfirmationResult = Schema.Struct({
  workflowRunId: Uuid,
  order: SalesOrder,
  reservations: Schema.Array(StockReservation),
  journal: JournalEntry,
  eventId: Uuid,
  jobId: Uuid,
})

export const OrderCancellationResult = Schema.Struct({
  workflowRunId: Uuid,
  order: SalesOrder,
  releasedReservations: Schema.Array(StockReservation),
  reversalJournal: JournalEntry,
  eventId: Uuid,
  jobId: Uuid,
})

export const OrderFulfillmentResult = Schema.Struct({
  workflowRunId: Uuid,
  order: SalesOrder,
  fulfilledReservations: Schema.Array(StockReservation),
  eventId: Uuid,
  jobId: Uuid,
})

export type ProcessJob = Schema.Schema.Type<typeof ProcessJob>

export type WorkflowRun = Schema.Schema.Type<typeof WorkflowRun>

export type OrderConfirmationResult = Schema.Schema.Type<typeof OrderConfirmationResult>

export type OrderCancellationResult = Schema.Schema.Type<typeof OrderCancellationResult>

export type OrderFulfillmentResult = Schema.Schema.Type<typeof OrderFulfillmentResult>

type OrderConfirmationFailure =
  | AccountingPeriodNotOpen
  | FinancialEngineActivated
  | AuthorizationDenied
  | DatabaseFailure
  | EventIdempotencyConflict
  | JournalIdempotencyConflict
  | RevenuePostingProfileNotFound
  | SalesOrderConfirmationIdempotencyConflict
  | SalesOrderInvalidState
  | SalesOrderNotFound
  | Schema.SchemaError
  | StockReservationIdempotencyConflict
  | StockReservationLegalEntityMismatch
  | StockUnavailable
  | WorkflowAlreadyCompleted
  | WorkflowAlreadyInProgress
  | WorkflowIdempotencyConflict
  | WorkflowManualRecoveryRequired
  | WorkflowOutcomeUnknown
  | WorkflowResultCorrupt
  | WorkflowRunNotFound

type OrderLifecycleFailure =
  | AccountingPeriodNotOpen
  | FinancialEngineActivated
  | AuthorizationDenied
  | DatabaseFailure
  | EventIdempotencyConflict
  | JournalIdempotencyConflict
  | OrderConfirmationCorrupt
  | OrderConfirmationNotFound
  | RevenueJournalNotFound
  | RevenuePostingProfileNotFound
  | SalesOrderInvalidState
  | SalesOrderNotFound
  | Schema.SchemaError
  | StockReservationInvalidState
  | StockReservationNotFound
  | StockUnavailable
  | WorkflowAlreadyInProgress
  | WorkflowIdempotencyConflict
  | WorkflowOutcomeUnknown
  | WorkflowResultCorrupt

export interface ProcessService {
  readonly confirmOrder: (
    input: Schema.Codec.Encoded<typeof ConfirmOrderConfirmationInput>,
  ) => Effect.Effect<OrderConfirmationResult, OrderConfirmationFailure>
  readonly cancelOrder: (
    input: Schema.Codec.Encoded<typeof CancelOrderInput>,
  ) => Effect.Effect<OrderCancellationResult, OrderLifecycleFailure>
  readonly fulfillOrder: (
    input: Schema.Codec.Encoded<typeof FulfillOrderInput>,
  ) => Effect.Effect<OrderFulfillmentResult, OrderLifecycleFailure>
  readonly recoverOrder: (
    input: Schema.Codec.Encoded<typeof RecoverOrderConfirmationInput>,
  ) => Effect.Effect<OrderConfirmationResult, OrderConfirmationFailure>
  readonly markManualRecovery: (
    input: Schema.Codec.Encoded<typeof ManualRecoveryInput>,
  ) => Effect.Effect<
    WorkflowRun,
    | AuthorizationDenied
    | DatabaseFailure
    | Schema.SchemaError
    | WorkflowAlreadyCompleted
    | WorkflowRunNotFound
  >
  readonly claimJob: (
    input: Schema.Codec.Encoded<typeof ProcessJobClaimInput>,
  ) => Effect.Effect<ProcessJob | null, DatabaseFailure | Schema.SchemaError | ProcessJobCorrupt>
  readonly renewJob: (
    input: Schema.Codec.Encoded<typeof ProcessJobRenewInput>,
  ) => Effect.Effect<
    ProcessJob,
    | DatabaseFailure
    | Schema.SchemaError
    | ProcessJobCorrupt
    | ProcessJobNotFound
    | ProcessJobLeaseLost
  >
  readonly completeJob: (
    input: Schema.Codec.Encoded<typeof ProcessJobCompleteInput>,
  ) => Effect.Effect<
    ProcessJob,
    | DatabaseFailure
    | Schema.SchemaError
    | ProcessJobCorrupt
    | ProcessJobNotFound
    | ProcessJobLeaseLost
  >
  readonly failJob: (
    input: Schema.Codec.Encoded<typeof ProcessJobFailInput>,
  ) => Effect.Effect<
    ProcessJob,
    | DatabaseFailure
    | Schema.SchemaError
    | ProcessJobCorrupt
    | ProcessJobNotFound
    | ProcessJobLeaseLost
  >
}

export const ProcessService = Context.Service<ProcessService>("RITSEI/ProcessService")
