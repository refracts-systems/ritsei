import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Predicate from "effect/Predicate"

import {
  ExternalIdentity,
  type ExternalIdentityType,
  IdentityProvider,
} from "../../../framework/modules/auth/mod.ts"
import {
  ExternalProviderUnavailable,
  InvalidExternalAssertion,
} from "../../../framework/modules/auth/mod.ts"
import type { OidcAuthenticationConfiguration, RitseiRuntimeConfiguration } from "../config.ts"

type JsonObject = Schema.JsonObject
type Jwk = JsonObject & { readonly kid?: string; readonly kty?: string; readonly alg?: string }

class InvalidTokenFormat extends Error {}
class ProviderUnavailable extends Error {}

const isObject = (value: unknown): value is JsonObject =>
  Predicate.isObjectOrArray(value) && !Array.isArray(value)

const decodeBase64Url = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new InvalidTokenFormat()
  const padded =
    value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4)
  const decoded = atob(padded)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

const decodeJsonPart = (value: string): JsonObject => {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(value)))
  if (!isObject(parsed)) throw new InvalidTokenFormat()
  return parsed
}

const readTextJson = async (response: Response): Promise<Schema.Json> => {
  if (!response.ok) throw new ProviderUnavailable()
  const text = await response.text()
  if (text.length > 1_048_576) throw new ProviderUnavailable()
  try {
    return Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text))
  } catch {
    throw new ProviderUnavailable()
  }
}

const hasAudience = (audience: unknown, expected: string): boolean =>
  Predicate.isString(audience)
    ? audience === expected
    : Array.isArray(audience) &&
      audience.every((value) => Predicate.isString(value)) &&
      audience.includes(expected)

export const makeOidcIdentityProvider = (
  configuration: OidcAuthenticationConfiguration,
): IdentityProvider => {
  let cachedKeys: readonly Jwk[] | undefined
  let cachedUntil = 0

  const loadKeys = async (force = false): Promise<readonly Jwk[]> => {
    if (!force && cachedKeys !== undefined && cachedUntil > Date.now()) return cachedKeys
    const response = await fetch(configuration.jwksUri, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {
      throw new ProviderUnavailable()
    })
    const document = await readTextJson(response)
    if (!isObject(document) || !Array.isArray(document.keys)) throw new ProviderUnavailable()
    // SAFETY: Jwk only adds optional members to a JSON object; each is compared before use.
    const keys = document.keys.filter(isObject) as readonly Jwk[]
    if (keys.length === 0) throw new ProviderUnavailable()
    cachedKeys = keys
    cachedUntil = Date.now() + 300_000
    return keys
  }

  const verify = async (assertion: string): Promise<ExternalIdentityType> => {
    if (assertion.length > 16_384) throw new InvalidTokenFormat()
    const parts = assertion.split(".")
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      throw new InvalidTokenFormat()
    }
    // SAFETY: parts.length === 3 was checked above.
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string]
    const header = decodeJsonPart(encodedHeader)
    const payload = decodeJsonPart(encodedPayload)
    if (header.alg !== "RS256" || !Predicate.isString(header.kid)) throw new InvalidTokenFormat()
    if (
      payload.iss !== configuration.issuerUrl ||
      !Predicate.isString(payload.sub) ||
      payload.sub.trim().length === 0 ||
      payload.sub.length > 1_024 ||
      !hasAudience(payload.aud, configuration.audience) ||
      !Predicate.isNumber(payload.exp) ||
      !Number.isInteger(payload.exp) ||
      !Predicate.isNumber(payload.iat) ||
      !Number.isInteger(payload.iat)
    )
      throw new InvalidTokenFormat()
    const now = Math.floor(Date.now() / 1_000)
    const nbf = payload.nbf
    if (
      payload.exp <= now ||
      payload.exp <= payload.iat ||
      (nbf !== undefined && (!Predicate.isNumber(nbf) || !Number.isInteger(nbf) || nbf > now + 60))
    ) {
      throw new InvalidTokenFormat()
    }
    if (payload.iat > now + 60) throw new InvalidTokenFormat()

    let keys = await loadKeys()
    let jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA")
    if (jwk === undefined) {
      keys = await loadKeys(true)
      jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA")
    }
    if (jwk === undefined) throw new ProviderUnavailable()
    const key = await crypto.subtle
      .importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])
      .catch(() => {
        throw new ProviderUnavailable()
      })
    const valid = await crypto.subtle
      .verify(
        { name: "RSASSA-PKCS1-v1_5" },
        key,
        // SAFETY: a Uint8Array built from a fresh array owns a plain ArrayBuffer, never a shared one.
        new Uint8Array(decodeBase64Url(encodedSignature)).buffer as ArrayBuffer,
        new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
      )
      .catch(() => false)
    if (!valid) throw new InvalidTokenFormat()
    return {
      issuer: payload.iss,
      subject: payload.sub,
      issuedAt: payload.iat,
    }
  }

  return {
    authenticate: (assertion) =>
      Effect.tryPromise({
        try: () => verify(assertion),
        catch: (error) =>
          error instanceof ProviderUnavailable
            ? new ExternalProviderUnavailable({})
            : new InvalidExternalAssertion({}),
      }).pipe(
        Effect.flatMap((identity) =>
          Schema.decodeUnknownEffect(ExternalIdentity)(identity).pipe(
            Effect.mapError(() => new InvalidExternalAssertion({})),
          ),
        ),
      ),
  }
}

export const identityProviderLayer = (configuration: RitseiRuntimeConfiguration) => {
  const authentication = configuration.authentication
  return authentication?.profile === "oidc"
    ? Layer.succeed(IdentityProvider, makeOidcIdentityProvider(authentication))
    : Layer.empty
}
