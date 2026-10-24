export { simulateWithoutSideEffect } from "./src/catalog.ts"

export type {
  ExternalCatalogEntry,
  ExternalSimulationResult,
  SimulateExternalActionInput,
} from "./src/catalog.ts"

export { CloudEventsEnvelope, normalizeCloudEvent } from "./src/cloudevents.ts"

export type {
  CloudEventsEnvelope as CloudEventsEnvelopeType,
  NormalizedExternalEvent,
  NormalizeExternalEventInput,
} from "./src/cloudevents.ts"

export {
  decodeExternalActionDefinition,
  decodeExternalEventDefinition,
  defineExternalAction,
  defineExternalEvent,
  ExternalActionDefinitionSchema,
  ExternalCatalogLimits,
  ExternalEventDefinitionSchema,
  ExternalIntegrationProfile,
  ExternalProblemDetails,
  isAllowlistedExternalAction,
  validateExternalActionDefinition,
  validateExternalEventDefinition,
} from "./src/contract.ts"

export type {
  ExternalActionCatalogEntry,
  ExternalActionIdempotency,
  ExternalEventCatalogEntry,
  ExternalSchema,
} from "./src/contract.ts"

export { makeMemoryExternalDeliveryStore } from "./src/delivery-store.ts"

export type {
  ExternalDeliveryLog,
  ExternalDeliveryStatus,
  ExternalDeliveryStore,
} from "./src/delivery-store.ts"

export {
  ExternalActionNotAllowlisted,
  ExternalAuthorizationDenied,
  ExternalCompatibilityMismatch,
  ExternalConnectorNotReviewed,
  ExternalConnectorRetired,
  ExternalConnectorVersionConflict,
  ExternalIdempotencyConflict,
  ExternalPayloadInvalid,
  ExternalPayloadLimitExceeded,
  ExternalProviderFailure,
  ExternalUnknownOutcome,
} from "./src/errors.ts"

export {
  ExternalConnectorGovernanceRecord,
  ExternalConnectorTransitionInput,
  ExternalDeliveryControlInput,
  ExternalGovernanceAuditAction,
  ExternalGovernanceAuditRecord,
  makePostgresExternalGovernanceStore,
  RegisterExternalConnectorInput,
} from "./src/governance-store.ts"

export type {
  ExternalConnectorGovernanceRecord as ExternalConnectorGovernanceRecordType,
  ExternalConnectorTransitionInput as ExternalConnectorTransitionInputType,
  ExternalDeliveryControlInput as ExternalDeliveryControlInputType,
  ExternalGovernanceAuditMutation,
  ExternalGovernanceAuditRecord as ExternalGovernanceAuditRecordType,
  ExternalGovernanceMutation,
  ExternalGovernanceStore,
  RegisterExternalConnectorInput as RegisterExternalConnectorInputType,
} from "./src/governance-store.ts"

export {
  activateExternalConnector,
  ExternalConnectorStatus,
  ExternalDeliveryControlKind,
  makeDeliveryControl,
  retireExternalConnector,
  reviewExternalConnector,
  validateExternalOperation,
} from "./src/governance.ts"

export type { ExternalConnectorDefinition, ExternalDeliveryControl } from "./src/governance.ts"

export { HttpsWebhookLimits, makeHttpsConnectorRuntime } from "./src/https-runtime.ts"

export type {
  HttpsConnectorRuntime,
  HttpsSignatureVerifier,
  HttpsWebhookInput,
} from "./src/https-runtime.ts"

export {
  OpenApiDocument,
  OpenApiImportRequest,
  OpenApiOperation,
  OpenApiOperationSelection,
  SupportedOpenApiMethod,
  validateOpenApiImport,
} from "./src/openapi.ts"

export type { OpenApiImportRequest as OpenApiImportRequestType } from "./src/openapi.ts"

export {
  makeExternalProcessActionMapping,
  simulateProcessExternalAction,
  toProcessExternalCatalogEntry,
} from "./src/process-bridge.ts"

export type {
  ExternalCatalogEntry as ExternalCatalogEntryForProcess,
  ExternalProcessActionMapping,
  ProcessExternalAction,
  ProcessExternalCatalogEntry,
  ProcessExternalEvent,
  ProcessExternalSimulationResult,
} from "./src/process-bridge.ts"

export {
  ExternalReliabilityHealth,
  ExternalReliabilityKind,
  ExternalReliabilityRecord,
  ExternalReliabilityRecordInput,
  makeMemoryExternalReliabilityStore,
  makePostgresExternalReliabilityStore,
} from "./src/reliability-store.ts"

export type {
  ExternalReliabilityHealth as ExternalReliabilityHealthType,
  ExternalReliabilityRecord as ExternalReliabilityRecordType,
  ExternalReliabilityRecordInput as ExternalReliabilityRecordInputType,
  ExternalReliabilityRecordResult,
  ExternalReliabilityStore,
} from "./src/reliability-store.ts"

export {
  assessExternalDelivery,
  ExternalDeliveryState,
  ExternalProviderStatus,
  redactExternalPayload,
} from "./src/reliability.ts"

export type { ExternalReliabilityDecision, ExternalReliabilityInput } from "./src/reliability.ts"

export {
  ExternalWebhookEnvelope,
  makeExternalConnectorRuntime,
  makeMemoryExternalConnectorStore,
  WebhookIngestion,
} from "./src/runtime.ts"

export type {
  ExternalActionInvoker,
  ExternalConnectorRuntime,
  ExternalEventIngestionResult,
  ExternalScopeAuthorizer,
  IngestExternalEventInput,
  InvokeExternalActionInput,
} from "./src/runtime.ts"

export type {
  ExternalConnectorStore,
  ExternalEventReceipt,
  ExternalInvocationReceipt,
  ExternalInvocationStatus,
} from "./src/store.ts"
