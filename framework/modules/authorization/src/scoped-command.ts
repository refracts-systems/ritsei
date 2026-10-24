import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { Principal } from "../../auth/mod.ts"
import type { AuthorizationService, Capability } from "./contract.ts"

type Scoped = {
  readonly principal: Schema.Schema.Type<typeof Principal>
  readonly tenantId: string
}

/**
 * Decodes a tenant-scoped command and authorizes one capability for its principal before the
 * owner acts on it: the paved road for "decode, authorize, then mutate or read".
 */
export const scopedCommand =
  (authorization: AuthorizationService) =>
  <T extends Scoped>(schema: Schema.Decoder<T>, capability: Capability) =>
  (input: Schema.Codec.Encoded<typeof schema>) =>
    Schema.decodeUnknownEffect(schema)(input).pipe(
      Effect.tap((decoded) =>
        authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability,
        }),
      ),
    )
