import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import {
  FinancialVerificationKeyGenerationFailure,
  FinancialVerificationKeyNotFound,
  FinancialVerificationKeyring,
  type FinancialVerificationKeyringService,
  FinancialVerificationSigner,
  type FinancialVerificationSignerService,
  FinancialVerificationSigningFailure,
  FinancialVerificationVerificationFailure,
  type FinancialVerificationVerifierService,
} from "../../modules/accounting/mod.ts"

const ed25519 = { name: "Ed25519" } as AlgorithmIdentifier

/**
 * Local development/test adapter.
 *
 * TODO(financial-prod): replace this implementation in the production composition
 * with the selected custody adapter. It may be software-managed, KMS-backed, or
 * HSM-backed; the selected policy must protect the private key, provide required
 * audit/recovery controls, and preserve this signer port.
 */
const makeEd25519FinancialVerificationSignerService = (
  keyId: string,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): FinancialVerificationSignerService => ({
  algorithm: "Ed25519",
  keyId,
  sign: (payload) =>
    Effect.tryPromise({
      try: async () =>
        new Uint8Array(
          await globalThis.crypto.subtle.sign(ed25519, privateKey, new Uint8Array(payload)),
        ),
      catch: () => new FinancialVerificationSigningFailure({ keyId }),
    }),
  verify: (payload, signature) =>
    Effect.tryPromise({
      try: () =>
        globalThis.crypto.subtle.verify(
          ed25519,
          publicKey,
          new Uint8Array(signature),
          new Uint8Array(payload),
        ),
      catch: () => new FinancialVerificationVerificationFailure({ keyId }),
    }),
})

/**
 * In-memory verifier registry for development and tests.
 *
 * TODO(financial-prod): replace this registry in the production composition
 * with a provider-backed public-key resolver that enforces key retention,
 * revocation, audit identity, and rotation policy.
 */
export const makeFinancialVerificationKeyring = (
  verifiers: readonly FinancialVerificationVerifierService[],
) => {
  const byKeyId = new Map(verifiers.map((verifier) => [verifier.keyId, verifier]))
  return Layer.succeed(FinancialVerificationKeyring, {
    verify: (keyId, payload, signature) => {
      const verifier = byKeyId.get(keyId)
      if (verifier === undefined) {
        return Effect.fail(new FinancialVerificationKeyNotFound({ keyId }))
      }
      return verifier.verify(payload, signature)
    },
  } satisfies FinancialVerificationKeyringService)
}

const makeFinancialVerificationSignerLayer = (signer: FinancialVerificationSignerService) =>
  Layer.mergeAll(
    Layer.succeed(FinancialVerificationSigner, signer),
    makeFinancialVerificationKeyring([signer]),
  )

export const makeEd25519FinancialVerificationSigner = (
  keyId: string,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
) =>
  makeFinancialVerificationSignerLayer(
    makeEd25519FinancialVerificationSignerService(keyId, privateKey, publicKey),
  )

/**
 * Generates an extractability-disabled local key for tests and development.
 *
 * TODO(financial-prod): production key generation/registration belongs to the selected
 * custody lifecycle, not this helper. This helper must never be used as production custody.
 */
export const generateEd25519FinancialVerificationSigner = (keyId: string) =>
  Effect.tryPromise({
    try: async () => {
      const pair = (await globalThis.crypto.subtle.generateKey(ed25519, false, [
        "sign",
        "verify",
      ])) as CryptoKeyPair
      const signer = makeEd25519FinancialVerificationSignerService(
        keyId,
        pair.privateKey,
        pair.publicKey,
      )
      return {
        pair,
        signer,
        layer: makeFinancialVerificationSignerLayer(signer),
      }
    },
    catch: () => new FinancialVerificationKeyGenerationFailure({ keyId }),
  })
