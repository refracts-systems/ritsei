import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import {
  AuthorizationDenied,
  AuthorizationService,
} from "../../../framework/modules/authorization/mod.ts"
import {
  IdentityAccountAuthorizer,
  IdentityAuthorizationDenied,
  IdentityCapabilities,
} from "../../../framework/modules/identity/mod.ts"

export const IdentityAccountAuthorizerLive = Layer.effect(
  IdentityAccountAuthorizer,
  Effect.gen(function* () {
    const authorization = yield* AuthorizationService
    return {
      authorize: (input: {
        readonly principal: { readonly userAccountId: string; readonly sessionId: string }
        readonly tenantId: string
      }) =>
        authorization
          .authorize({
            principal: input.principal,
            tenantId: input.tenantId,
            capability: IdentityCapabilities.userAccountCreate,
          })
          .pipe(
            Effect.mapError((error) =>
              error instanceof AuthorizationDenied
                ? new IdentityAuthorizationDenied({
                    tenantId: error.tenantId,
                    capability: error.capability,
                  })
                : error,
            ),
          ),
    }
  }),
)
