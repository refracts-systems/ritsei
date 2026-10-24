export {
  AppendEventInput,
  ConsumeOnceInput,
  ConsumerReceipt,
  EventEnvelope,
  GetEventInput,
} from "./src/contract.ts"

export type {
  AppendEventInput as AppendEventInputContract,
  ConsumeOnceInput as ConsumeOnceInputContract,
  ConsumeOnceResult,
  ConsumerReceipt as ConsumerReceiptContract,
  EventEnvelope as EventEnvelopeContract,
  GetEventInput as GetEventInputContract,
} from "./src/contract.ts"

export { EventIdempotencyConflict } from "./src/errors.ts"

export {
  makeMessagingService,
  makeMessagingTestLayer,
  MessagingLive,
  MessagingService,
} from "./src/service.ts"

export type { MessagingService as MessagingServiceContract } from "./src/service.ts"
