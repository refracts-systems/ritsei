import * as Layer from "effect/Layer"

import { DurableJobEnqueuer } from "../../../../framework/foundation/mod.ts"
import { ProcessService } from "./contract.ts"
import {
  makeMemoryProcessOperatorStore,
  makePostgresProcessOperatorStore,
  ProcessOperatorStore,
} from "./operations-store.ts"
import { makeProcessJobEnqueuer, makeProcessService } from "./postgres.ts"
import {
  makeMemoryProcessReleaseStore,
  makePostgresProcessReleaseStore,
  ProcessReleaseStore,
} from "./release-store.ts"
import {
  makeMemoryProcessCheckpointStore,
  makePostgresProcessCheckpointStore,
  ProcessCheckpointStore,
} from "./runtime-store.ts"
import { makeProcessStudioService, ProcessStudioService } from "./studio.ts"

export const ProcessLive = Layer.effect(ProcessService, makeProcessService)
export const ProcessJobEnqueuerLive = Layer.effect(DurableJobEnqueuer, makeProcessJobEnqueuer)
export const ProcessPostgresLive = ProcessLive
export const ProcessStudioLive = Layer.effect(ProcessStudioService, makeProcessStudioService)
export const ProcessStudioPostgresLive = ProcessStudioLive
export const ProcessRuntimeMemoryLive = Layer.succeed(
  ProcessCheckpointStore,
  makeMemoryProcessCheckpointStore(),
)
export const ProcessRuntimePostgresLive = Layer.effect(
  ProcessCheckpointStore,
  makePostgresProcessCheckpointStore,
)
export const ProcessOperatorMemoryLive = Layer.succeed(
  ProcessOperatorStore,
  makeMemoryProcessOperatorStore(),
)
export const ProcessOperatorPostgresLive = Layer.effect(
  ProcessOperatorStore,
  makePostgresProcessOperatorStore,
)
export const ProcessReleaseMemoryLive = Layer.succeed(
  ProcessReleaseStore,
  makeMemoryProcessReleaseStore(),
)
export const ProcessReleasePostgresLive = Layer.effect(
  ProcessReleaseStore,
  makePostgresProcessReleaseStore,
)

export { makeProcessService }
