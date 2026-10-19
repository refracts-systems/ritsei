import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import {
  FinancialVerificationKeyNotFound,
  FinancialVerificationKeyring,
} from "../../modules/accounting/mod.ts"
import {
  generateEd25519FinancialVerificationSigner,
  makeFinancialVerificationKeyring,
} from "./financial-verification-signer.ts"

it.effect("signs and verifies a readiness payload with an explicit key id", () =>
  Effect.gen(function* () {
    const generated = yield* generateEd25519FinancialVerificationSigner("test-key")
    const payload = new TextEncoder().encode("artifact-hash")
    const signature = yield* generated.signer.sign(payload)
    assert.strictEqual(generated.pair.privateKey.extractable, false)
    assert.isTrue(yield* generated.signer.verify(payload, signature))
    assert.isFalse(
      yield* generated.signer.verify(new TextEncoder().encode("different-hash"), signature),
    )
  }),
)

it.effect("verifies with multiple historical keys and fails closed for an unknown key", () =>
  Effect.gen(function* () {
    const oldKey = yield* generateEd25519FinancialVerificationSigner("old-key")
    const currentKey = yield* generateEd25519FinancialVerificationSigner("current-key")
    const payload = new TextEncoder().encode("artifact-hash")
    const signature = yield* oldKey.signer.sign(payload)
    yield* Effect.gen(function* () {
      const keyring = yield* FinancialVerificationKeyring
      assert.isTrue(yield* keyring.verify("old-key", payload, signature))
      assert.isFalse(yield* keyring.verify("current-key", payload, signature))
      assert.instanceOf(
        yield* Effect.flip(keyring.verify("missing-key", payload, signature)),
        FinancialVerificationKeyNotFound,
      )
    }).pipe(Effect.provide(makeFinancialVerificationKeyring([oldKey.signer, currentKey.signer])))
  }),
)
