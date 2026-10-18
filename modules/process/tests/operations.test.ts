import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  makeProcessOperatorService,
  ProcessCheckpoint,
  ProcessOperatorActionUnavailable,
} from "../mod.ts"

const baseCheckpoint = {
  instanceId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
  tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214122",
  processDefinitionId: "018f3f77-0c5a-7cc0-8b62-6a163d214124",
  processDefinitionVersion: 1,
  catalogVersion: 1,
  environment: "TEST",
  status: "failed",
  failureKind: "unknown_external_outcome",
  currentNodeId: "payment",
  revision: 0,
  completedStepIds: [],
  stepExecutions: [{
    stepId: "step-1",
    nodeId: "payment",
    idempotencyKey: "payment-1",
    status: "command_failed",
    commandId: "command-1",
    eventId: null,
  }],
  consumedEventIds: [],
  scheduledTimerIds: [],
  correlationId: "correlation-1",
  causationId: null,
  executionPrincipal: "process-principal-1",
} as const

it.effect("distinguishes unknown external outcome from manual recovery", () =>
  Effect.gen(function*() {
    const checkpoint = yield* Schema.decodeUnknownEffect(ProcessCheckpoint)(baseCheckpoint)
    const operator = makeProcessOperatorService()
    const snapshot = operator.inspect(checkpoint)
    const recovered = yield* operator.requireManualRecovery(checkpoint)

    assert.strictEqual(snapshot.requiredAction, "manual_recovery")
    assert.strictEqual(snapshot.correlationId, "correlation-1")
    assert.strictEqual(recovered.status, "manual_recovery")
    assert.strictEqual(recovered.stepExecutions[0]?.status, "manual_recovery_required")
  }))

it.effect("exposes a typed operator control for retry and compensation", () =>
  Effect.gen(function*() {
    const checkpoint = yield* Schema.decodeUnknownEffect(ProcessCheckpoint)({
      ...baseCheckpoint,
      status: "running",
      failureKind: "technical_retry",
      stepExecutions: [{ ...baseCheckpoint.stepExecutions[0]!, status: "retry_scheduled" }],
    })
    const operator = makeProcessOperatorService()
    const retried = yield* operator.retry(checkpoint)
    const retryFailure = yield* Effect.flip(operator.startCompensation(checkpoint))

    assert.strictEqual(retried.status, "running")
    assert.strictEqual(retried.stepExecutions[0]?.status, "command_requested")
    assert.instanceOf(retryFailure, ProcessOperatorActionUnavailable)
  }))
