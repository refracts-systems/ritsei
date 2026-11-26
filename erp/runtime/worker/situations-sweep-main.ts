import "../../../tooling/load-env.ts"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Effect from "effect/Effect"

import { isMain } from "../../../tooling/entrypoint.ts"
import { readRuntimeConfiguration } from "../config.ts"
import { startSituationsSweep } from "./mod.ts"

/**
 * Runs the situations sweep as its own process. SITUATIONS_SWEEP_USER_ID is a service account that
 * holds the detect capability and may read accounting configurations. SITUATIONS_LEGAL_ENTITY_IDS is an
 * optional comma-separated list; omitted, every legal entity with accounting configured is swept.
 */
if (isMain(import.meta.url)) {
  const url = process.env["DATABASE_URL"]
  const tenantId = process.env["WORKER_TENANT_ID"]
  const userAccountId = process.env["SITUATIONS_SWEEP_USER_ID"]?.trim()

  const legalEntityIds = (process.env["SITUATIONS_LEGAL_ENTITY_IDS"] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0)

  const intervalMs = Number(process.env["SITUATIONS_SWEEP_INTERVAL_MS"] ?? 300_000)

  if (
    url === undefined ||
    tenantId === undefined ||
    !userAccountId ||
    !Number.isInteger(intervalMs) ||
    intervalMs < 1_000
  ) {
    console.error(
      "DATABASE_URL, WORKER_TENANT_ID, and SITUATIONS_SWEEP_USER_ID are required; SITUATIONS_SWEEP_INTERVAL_MS is at least 1000",
    )
    process.exit(1)
  }

  Effect.gen(function* () {
    const configuration = yield* readRuntimeConfiguration()

    const input = { tenantId, principal: { userAccountId, sessionId: "situations-sweep" } }

    yield* startSituationsSweep(
      url,
      legalEntityIds.length > 0 ? { ...input, legalEntityIds } : input,
      configuration,
      intervalMs,
    )
  }).pipe(NodeRuntime.runMain)
}
