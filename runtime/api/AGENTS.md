# runtime/api rules

HTTP-specific rules; repository-wide rules are in the root [`AGENTS.md`](../../AGENTS.md).
Related: [`integration-architecture.md`](../../docs/architecture/integration-architecture.md).

- HTTP contracts, routing, request decoding, error encoding, and OpenAPI use Effect v4 `HttpApi`,
  `HttpApiGroup`, `HttpApiEndpoint`, `HttpApiBuilder`, and `HttpRouter`. Never use Hono, Express,
  Fastify, or NestJS.
- `@effect/platform-node` is the server adapter and runtime entrypoint. Application code does not
  import `node:http`.
- Use Effect HttpApi security middleware for bearer, cookie, or API-key authentication boundaries.
- Handlers stay thin: decode transport input with Effect Schema, call public domain services only,
  and map domain failures to stable transport errors (RFC 9457 Problem Details) without database
  details or stack traces.
- Protected behavior is enforced by the backend; authentication and authorization are separate.
