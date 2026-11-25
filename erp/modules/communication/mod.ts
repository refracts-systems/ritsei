export { CommunicationCapabilities } from "./src/capabilities.ts"

export {
  CommunicationConfiguration,
  CommunicationPolicy,
  CommunicationPreview,
  CommunicationProcessingResult,
  CommunicationQueryInput,
  CommunicationService,
  CommunicationTestTransport,
  HistoricalDispatchOutcome,
  HistoricalDispatchResult,
  HistoricalDocumentRef,
  ProcessPurchaseOrderConfirmedInput,
  RecordHistoricalDispatchInput,
  RetryCommunicationInput,
  SendCommunicationInput,
} from "./src/contract.ts"

export type {
  CommunicationConfiguration as CommunicationConfigurationContract,
  CommunicationProcessingResult as CommunicationProcessingResultContract,
  CommunicationService as CommunicationServiceContract,
} from "./src/contract.ts"

export {
  CommunicationNotFound,
  CommunicationPreviewStale,
  CommunicationStateFailure,
  UnsupportedCommunicationEvent,
} from "./src/errors.ts"

export type { CommunicationTestLayerOptions } from "./src/layers.ts"

export { makeCommunicationTestLayer } from "./src/layers.ts"

export { CommunicationModule } from "./manifest.ts"
