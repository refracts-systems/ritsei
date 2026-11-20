import { assert, it } from "@effect/vitest"
import * as Digest from "effect/crypto/Digest"
import * as SecureRandom from "effect/crypto/SecureRandom"
import * as Effect from "effect/Effect"

import { WebCryptoLive } from "../mod.ts"

it.effect("provides cryptography through the Effect environment", () =>
  Effect.gen(function* () {
    const digest = yield* Digest.Digest
    const random = yield* SecureRandom.SecureRandom
    const hex = yield* digest.digestHex(Digest.sha256, new TextEncoder().encode("hello"))

    assert.strictEqual(hex, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
    assert.strictEqual((yield* random.randomBytes(32)).length, 32)
  }).pipe(Effect.provide(WebCryptoLive)),
)
