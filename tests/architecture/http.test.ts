import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { readFile } from "node:fs/promises"

const apiFiles = ["erp/runtime/api/api.ts", "erp/runtime/api/handlers.ts", "erp/runtime/api/mod.ts"]

it.effect("keeps HTTP routing Effect-native", () =>
  Effect.gen(function* () {
    const source = yield* Effect.promise(async () =>
      (await Promise.all(apiFiles.map((path) => readFile(path, "utf8")))).join("\n"),
    )

    for (const forbidden of [
      "Deno.serve",
      'from "node:http"',
      'from "@effect/platform-deno',
      'from "hono"',
      'from "express"',
      'from "fastify"',
      'from "@nestjs/',
    ]) {
      assert.notInclude(source, forbidden)
    }
    assert.include(source, "effect/http/HttpRouter")
    assert.include(source, "effect/http-api/HttpApiEndpoint")
    assert.include(source, "@effect/platform-node/NodeHttpServer")
    assert.include(source, "@effect/platform-node/NodeRuntime")
  }),
)
