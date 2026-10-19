import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  Communication,
  CommunicationArtifact,
  CommunicationContextFailure,
  CommunicationIntent,
  CommunicationRecipientResolutionFailure,
  CommunicationRenderFailure,
  CommunicationTransportFailure,
  DatabaseFailure,
  DeliveryAttempt,
  DeliveryReceipt,
  PreparedEmail,
  SenderIdentity,
} from "../../../../framework/foundation/mod.ts"
import { EventEnvelope } from "../../../../framework/modules/messaging/mod.ts"
import {
  CommunicationNotFound,
  CommunicationStateFailure,
  UnsupportedCommunicationEvent,
} from "./errors.ts"

const Uuid = Schema.String.check(Schema.isUUID())

export const ProcessPurchaseOrderConfirmedInput = Schema.Struct({
  event: EventEnvelope,
})
export type ProcessPurchaseOrderConfirmedInput = Schema.Schema.Type<
  typeof ProcessPurchaseOrderConfirmedInput
>

export const RetryCommunicationInput = Schema.Struct({
  communicationId: Uuid,
})
export type RetryCommunicationInput = Schema.Schema.Type<typeof RetryCommunicationInput>

export const CommunicationProcessingResult = Schema.Struct({
  duplicate: Schema.Boolean,
  intent: CommunicationIntent,
  communication: Communication,
  artifact: CommunicationArtifact,
  attempt: Schema.NullOr(DeliveryAttempt),
  receipt: Schema.NullOr(DeliveryReceipt),
})
export type CommunicationProcessingResult = Schema.Schema.Type<typeof CommunicationProcessingResult>

export interface CommunicationConfiguration {
  readonly sender: SenderIdentity
}

export const CommunicationConfiguration = Context.Service<CommunicationConfiguration>(
  "RITSEI/CommunicationConfiguration",
)

export interface CommunicationPolicy {
  readonly derivePurchaseOrderConfirmed: (
    input: unknown,
  ) => Effect.Effect<CommunicationIntent, UnsupportedCommunicationEvent | Schema.SchemaError>
}

export const CommunicationPolicy = Context.Service<CommunicationPolicy>(
  "RITSEI/CommunicationPolicy",
)

export interface CommunicationService {
  readonly processPurchaseOrderConfirmed: (
    input: unknown,
  ) => Effect.Effect<
    CommunicationProcessingResult,
    | CommunicationNotFound
    | CommunicationStateFailure
    | UnsupportedCommunicationEvent
    | CommunicationRecipientResolutionFailure
    | CommunicationContextFailure
    | CommunicationRenderFailure
    | DatabaseFailure
    | Schema.SchemaError
  >
  readonly deliver: (
    input: unknown,
  ) => Effect.Effect<
    CommunicationProcessingResult,
    | CommunicationNotFound
    | CommunicationStateFailure
    | CommunicationTransportFailure
    | Schema.SchemaError
  >
  readonly retry: (
    input: unknown,
  ) => Effect.Effect<
    CommunicationProcessingResult,
    | CommunicationNotFound
    | CommunicationStateFailure
    | CommunicationTransportFailure
    | Schema.SchemaError
  >
}

export const CommunicationService = Context.Service<CommunicationService>(
  "RITSEI/CommunicationService",
)

export interface CommunicationTestTransport {
  readonly sent: ReadonlyArray<PreparedEmail>
}

export const CommunicationTestTransport = Context.Service<CommunicationTestTransport>(
  "RITSEI/CommunicationTestTransport",
)
