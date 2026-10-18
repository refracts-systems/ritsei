import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export class FinancialVerificationSigningFailure extends Schema.TaggedError<FinancialVerificationSigningFailure>()(
  "FinancialVerificationSigningFailure",
  { keyId: Schema.String },
) {}

export class FinancialVerificationVerificationFailure extends Schema.TaggedError<FinancialVerificationVerificationFailure>()(
  "FinancialVerificationVerificationFailure",
  { keyId: Schema.String },
) {}

export class FinancialVerificationKeyGenerationFailure extends Schema.TaggedError<FinancialVerificationKeyGenerationFailure>()(
  "FinancialVerificationKeyGenerationFailure",
  { keyId: Schema.String },
) {}

export interface FinancialVerificationVerifierService {
  readonly algorithm: "Ed25519"
  readonly keyId: string
  readonly verify: (
    payload: Uint8Array,
    signature: Uint8Array,
  ) => Effect.Effect<boolean, FinancialVerificationVerificationFailure>
}

export interface FinancialVerificationSignerService extends FinancialVerificationVerifierService {
  readonly sign: (
    payload: Uint8Array,
  ) => Effect.Effect<Uint8Array, FinancialVerificationSigningFailure>
}

export class FinancialVerificationKeyNotFound extends Schema.TaggedError<FinancialVerificationKeyNotFound>()(
  "FinancialVerificationKeyNotFound",
  { keyId: Schema.String },
) {}

export interface FinancialVerificationKeyringService {
  readonly verify: (
    keyId: string,
    payload: Uint8Array,
    signature: Uint8Array,
  ) => Effect.Effect<
    boolean,
    FinancialVerificationKeyNotFound | FinancialVerificationVerificationFailure
  >
}

export const FinancialVerificationSigner = Context.Service<FinancialVerificationSignerService>(
  "RITSEI/FinancialVerificationSigner",
)

export const FinancialVerificationKeyring = Context.Service<FinancialVerificationKeyringService>(
  "RITSEI/FinancialVerificationKeyring",
)
