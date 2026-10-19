import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { parseRuntimeConfiguration } from "./config.ts"

const environment = (
  values: Record<string, string>,
  defaultAuthenticationProfile: string | null = "transitional-local",
) => ({
  get: (name: string) =>
    values[name] ??
    (name === "RITSEI_AUTH_PROFILE" ? (defaultAuthenticationProfile ?? undefined) : undefined),
})

describe("runtime configuration", () => {
  it.effect("requires an explicit authentication profile", () =>
    Effect.gen(function* () {
      const failure = yield* parseRuntimeConfiguration(environment({}, null)).pipe(Effect.flip)
      assert.strictEqual(failure.reason, "missing_authentication_configuration")
    }),
  )

  it.effect("defaults to the entry deployment profile", () =>
    Effect.gen(function* () {
      const configuration = yield* parseRuntimeConfiguration(environment({}))
      assert.strictEqual(configuration.deploymentProfile, "entry")
      assert.deepStrictEqual(configuration.authentication, { profile: "transitional-local" })
    }),
  )

  it.effect("parses provider-neutral OIDC settings", () =>
    Effect.gen(function* () {
      const configuration = yield* parseRuntimeConfiguration(
        environment({
          RITSEI_AUTH_PROFILE: "oidc",
          RITSEI_OIDC_ISSUER_URL: "https://id.example.com",
          RITSEI_OIDC_AUDIENCE: "ritsei-api",
          RITSEI_OIDC_CLIENT_ID: "ritsei-web",
          RITSEI_OIDC_AUTHORIZATION_ENDPOINT: "https://id.example.com/oauth2/authorize",
          RITSEI_OIDC_TOKEN_ENDPOINT: "https://id.example.com/oauth2/token",
          RITSEI_OIDC_JWKS_URI: "https://id.example.com/.well-known/jwks.json",
          RITSEI_OIDC_REDIRECT_URI: "http://127.0.0.1:5173/auth/callback",
        }),
      )
      assert.strictEqual(configuration.authentication?.profile, "oidc")
      if (configuration.authentication?.profile !== "oidc") return
      assert.strictEqual(configuration.authentication.issuerUrl, "https://id.example.com")
      assert.deepStrictEqual(configuration.authentication.scopes, ["openid", "profile", "email"])
    }),
  )

  it.effect("rejects incomplete OIDC settings", () =>
    Effect.gen(function* () {
      const failure = yield* parseRuntimeConfiguration(
        environment({
          RITSEI_AUTH_PROFILE: "oidc",
          RITSEI_OIDC_ISSUER_URL: "https://id.example.com",
        }),
      ).pipe(Effect.flip)
      assert.strictEqual(failure.reason, "missing_oidc_configuration")
    }),
  )

  it.effect("rejects non-HTTPS and credential-bearing OIDC URLs", () =>
    Effect.gen(function* () {
      const failure = yield* parseRuntimeConfiguration(
        environment({
          RITSEI_AUTH_PROFILE: "oidc",
          RITSEI_OIDC_ISSUER_URL: "ftp://localhost/issuer",
          RITSEI_OIDC_AUDIENCE: "ritsei-api",
          RITSEI_OIDC_CLIENT_ID: "ritsei-web",
          RITSEI_OIDC_AUTHORIZATION_ENDPOINT: "https://id.example.com/oauth2/authorize",
          RITSEI_OIDC_TOKEN_ENDPOINT: "https://id.example.com/oauth2/token",
          RITSEI_OIDC_JWKS_URI: "https://id.example.com/.well-known/jwks.json",
          RITSEI_OIDC_REDIRECT_URI: "http://127.0.0.1:5173/auth/callback",
        }),
      ).pipe(Effect.flip)
      assert.strictEqual(failure.reason, "invalid_oidc_configuration")
    }),
  )

  it.effect("reads the deployment profile", () =>
    Effect.gen(function* () {
      const configuration = yield* parseRuntimeConfiguration(
        environment({ RITSEI_DEPLOYMENT_PROFILE: "standard" }),
      )
      assert.strictEqual(configuration.deploymentProfile, "standard")
    }),
  )

  it.effect("requires complete PostgreSQL read-your-writes settings when enabled", () =>
    Effect.gen(function* () {
      const failure = yield* parseRuntimeConfiguration(
        environment({
          RITSEI_POSTGRES_RYW_ENABLED: "true",
        }),
      ).pipe(Effect.flip)
      assert.strictEqual(failure._tag, "RuntimeConfigurationFailure")
      assert.strictEqual(failure.reason, "missing_postgres_read_your_writes_configuration")
    }),
  )

  it.effect("decodes bounded PostgreSQL read-your-writes settings", () =>
    Effect.gen(function* () {
      const configuration = yield* parseRuntimeConfiguration(
        environment({
          RITSEI_POSTGRES_RYW_ENABLED: "true",
          POSTGRES_REPLICA_URL: "postgresql://replica/ritsei",
          RITSEI_POSTGRES_PLACEMENT_ID: "local-cluster",
          RITSEI_POSTGRES_CONSISTENCY_SECRET: "01234567890123456789012345678901",
          RITSEI_POSTGRES_RYW_MAX_WAIT_MS: "750",
          RITSEI_POSTGRES_CONSISTENCY_TTL_MS: "120000",
        }),
      )
      assert.deepStrictEqual(configuration.postgresReadYourWrites, {
        replicaUrl: "postgresql://replica/ritsei",
        placementId: "local-cluster",
        secret: "01234567890123456789012345678901",
        maxWaitMs: 750,
        tokenTtlMs: 120000,
      })
    }),
  )

  it.effect("rejects unsafe PostgreSQL read-your-writes bounds", () =>
    Effect.gen(function* () {
      const failure = yield* parseRuntimeConfiguration(
        environment({
          RITSEI_POSTGRES_RYW_ENABLED: "true",
          POSTGRES_REPLICA_URL: "postgresql://replica/ritsei",
          RITSEI_POSTGRES_PLACEMENT_ID: "local-cluster",
          RITSEI_POSTGRES_CONSISTENCY_SECRET: "too-short",
          RITSEI_POSTGRES_RYW_MAX_WAIT_MS: "0",
        }),
      ).pipe(Effect.flip)
      assert.strictEqual(failure._tag, "RuntimeConfigurationFailure")
      assert.strictEqual(failure.reason, "invalid_postgres_read_your_writes_configuration")
    }),
  )
})
