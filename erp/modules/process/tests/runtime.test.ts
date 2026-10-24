import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  makeProcessRuntime,
  ProcessCheckpoint,
  ProcessDefinition,
  ProcessRuntimeVersionConflict,
  ProcessStepConflict,
} from "../mod.ts"

const checkpointInput = {
  instanceId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
  tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214122",
  processDefinitionId: "018f3f77-0c5a-7cc0-8b62-6a163d214124",
  processDefinitionVersion: 1,
  catalogVersion: 1,
  environment: "TEST",
  status: "running",
  failureKind: null,
  currentNodeId: "start",
  revision: 0,
  completedStepIds: [],
  stepExecutions: [],
  consumedEventIds: [],
  scheduledTimerIds: [],
  correlationId: "correlation-1",
  causationId: null,
  executionPrincipal: "process-principal-1",
} as const

it.effect("proves crash recovery from a serialized checkpoint", () =>
  Effect.gen(function* () {
    const checkpoint = yield* Schema.decodeUnknownEffect(ProcessCheckpoint)(checkpointInput)
    const runtime = makeProcessRuntime()
    const scheduled = yield* runtime.scheduleTimer(checkpoint, "timer-1")
    const recovered = yield* runtime.recoverCheckpoint(JSON.parse(JSON.stringify(scheduled)))

    assert.deepStrictEqual(recovered, scheduled)
    assert.deepStrictEqual(recovered.scheduledTimerIds, ["timer-1"])
  }),
)

it.effect("suppresses a duplicate event and duplicate command", () =>
  Effect.gen(function* () {
    const checkpoint = yield* Schema.decodeUnknownEffect(ProcessCheckpoint)(checkpointInput)
    const runtime = makeProcessRuntime()

    const execution = {
      stepId: "step-1",
      nodeId: "confirm",
      idempotencyKey: "step-1-key",
      status: "command_succeeded" as const,
      commandId: "command-1",
      eventId: null,
    }

    const firstCommand = yield* runtime.recordCommand(checkpoint, execution)
    const replayedCommand = yield* runtime.recordCommand(firstCommand, execution)

    const firstEvent = yield* runtime.recordEvent(
      replayedCommand,
      "018f3f77-0c5a-7cc0-8b62-6a163d214125",
    )

    const replayedEvent = yield* runtime.recordEvent(
      firstEvent,
      "018f3f77-0c5a-7cc0-8b62-6a163d214125",
    )

    assert.deepStrictEqual(replayedCommand, firstCommand)
    assert.deepStrictEqual(replayedEvent, firstEvent)
    assert.deepStrictEqual(replayedEvent.completedStepIds, ["step-1"])
    assert.deepStrictEqual(replayedEvent.consumedEventIds, ["018f3f77-0c5a-7cc0-8b62-6a163d214125"])

    const conflict = yield* Effect.flip(
      runtime.recordCommand(firstCommand, {
        ...execution,
        idempotencyKey: "different-key",
      }),
    )

    assert.instanceOf(conflict, ProcessStepConflict)
  }),
)

it.effect("pins the exact catalog version", () =>
  Effect.gen(function* () {
    const checkpoint = yield* Schema.decodeUnknownEffect(ProcessCheckpoint)(checkpointInput)
    const runtime = makeProcessRuntime()
    const pinned = yield* runtime.pinCatalogVersion(checkpoint, 1)
    const conflict = yield* Effect.flip(runtime.pinCatalogVersion(checkpoint, 2))

    assert.strictEqual(pinned.catalogVersion, 1)
    assert.instanceOf(conflict, ProcessRuntimeVersionConflict)
    assert.strictEqual(conflict.pinnedCatalogVersion, 1)
    assert.strictEqual(conflict.requestedCatalogVersion, 2)
  }),
)

it.effect("validates the bounded Process IR node kinds", () =>
  Effect.gen(function* () {
    const definition = yield* Schema.decodeUnknownEffect(ProcessDefinition)({
      id: checkpointInput.processDefinitionId,
      version: 1,
      catalogVersion: 1,
      environment: "TEST",
      nodes: [
        { id: "start", kind: "Start" },
        { id: "command", kind: "DomainCommand" },
        { id: "task", kind: "HumanTask" },
        { id: "decision", kind: "Decision" },
        { id: "wait", kind: "WaitForEvent" },
        { id: "timer", kind: "Timer" },
        { id: "parallel", kind: "ParallelBranch" },
        { id: "end", kind: "End" },
      ],
      edges: [{ from: "start", to: "command" }],
      checksum: "sha256:process-1",
    })

    assert.strictEqual(definition.nodes.length, 8)
    assert.strictEqual(definition.catalogVersion, 1)
  }),
)
