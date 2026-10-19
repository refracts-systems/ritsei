import * as Schema from "effect/Schema"

import { EventEnvelope } from "../../../../framework/modules/messaging/mod.ts"

const Uuid = EventEnvelope.fields.eventId
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))

export class OrderConfirmationNotFound extends Schema.TaggedError<OrderConfirmationNotFound>()(
  "OrderConfirmationNotFound",
  {
    tenantId: Uuid,
    orderId: Uuid,
  },
) {}
export class OrderConfirmationCorrupt extends Schema.TaggedError<OrderConfirmationCorrupt>()(
  "OrderConfirmationCorrupt",
  {
    tenantId: Uuid,
    orderId: Uuid,
  },
) {}
export class WorkflowRunNotFound extends Schema.TaggedError<WorkflowRunNotFound>()(
  "WorkflowRunNotFound",
  {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
  },
) {}
export class WorkflowIdempotencyConflict extends Schema.TaggedError<WorkflowIdempotencyConflict>()(
  "WorkflowIdempotencyConflict",
  {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
  },
) {}
export class WorkflowAlreadyInProgress extends Schema.TaggedError<WorkflowAlreadyInProgress>()(
  "WorkflowAlreadyInProgress",
  {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
  },
) {}
export class WorkflowManualRecoveryRequired extends Schema.TaggedError<WorkflowManualRecoveryRequired>()(
  "WorkflowManualRecoveryRequired",
  {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
    reason: NonEmptyString,
  },
) {}
export class WorkflowResultCorrupt extends Schema.TaggedError<WorkflowResultCorrupt>()(
  "WorkflowResultCorrupt",
  {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
  },
) {}
export class WorkflowOutcomeUnknown extends Schema.TaggedError<WorkflowOutcomeUnknown>()(
  "WorkflowOutcomeUnknown",
  {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
  },
) {}
export class WorkflowAlreadyCompleted extends Schema.TaggedError<WorkflowAlreadyCompleted>()(
  "WorkflowAlreadyCompleted",
  {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
  },
) {}
export class ProcessJobLeaseLost extends Schema.TaggedError<ProcessJobLeaseLost>()(
  "ProcessJobLeaseLost",
  {
    tenantId: Uuid,
    jobId: Uuid,
  },
) {}
export class ProcessJobNotFound extends Schema.TaggedError<ProcessJobNotFound>()(
  "ProcessJobNotFound",
  {
    tenantId: Uuid,
    jobId: Uuid,
  },
) {}
export class ProcessJobCorrupt extends Schema.TaggedError<ProcessJobCorrupt>()(
  "ProcessJobCorrupt",
  {
    tenantId: Uuid,
    jobId: Uuid,
  },
) {}
