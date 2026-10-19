# ADR-0084: Establish Explicit Progressive Trust Boundaries

- Status: Superseded
- Date: 2026-09-10
- Amends: None
- Compatible with: ADR-0006, ADR-0007, ADR-0013, ADR-0014, ADR-0015, ADR-0018, ADR-0019, ADR-0020, ADR-0024, ADR-0034, ADR-0058, ADR-0059, ADR-0063, ADR-0083
- Supersedes: None
- Superseded by: ADR-0091 (product reset)

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - HTTP API boundary: [`../architecture/api.md`](../architecture/api.md)
> - Identity and principals: [`../architecture/identity-and-principals.md`](../architecture/identity-and-principals.md)
> - Authorization: [`../architecture/authorization.md`](../architecture/authorization.md)
> - Integration surface: [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
> - Process Studio: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Governed AI boundary: [`./0063-define-governed-ai-recommendation-and-agent-boundary.md`](./0063-define-governed-ai-recommendation-and-agent-boundary.md)

## Context

RITSEI already requires runtime contract decoding, explicit principals, deny-by-default
authorization, owner-controlled commands, deterministic processes, and non-authoritative AI and
integration adapters. These rules are currently distributed across subsystem documents.

A cross-cutting rule is needed because successful parsing or typing does not establish identity,
authority, domain validity, or business truth. TypeScript `unknown` is useful discipline, but it is
erased at runtime; the security boundary is the decoder and the subsequent owner-controlled checks.
Low-level protocol, parser, deserializer, runtime, and resource failures can also occur before
application authorization has an opportunity to run. Effect Schema therefore provides a semantic
boundary, not a complete machine-safety boundary.

## Decision

RITSEI adopts **progressive trust** as the security model for every external or reintroduced
representation:

```text
raw bytes / external representation
  -> bounded protocol handling
  -> runtime-decoded representation
  -> validated external value
  -> domain mapping and value objects
  -> authenticated identity or verified source
  -> scoped authorization
  -> domain-valid command
  -> versioned deterministic process
  -> committed business fact
```

The sequence is conceptual, not a universal middleware order. Authentication or signature
verification may precede payload decoding, and transport-specific checks may be ordered differently.
The invariant is that every applicable boundary is explicit and every required check completes
before the owning command can establish a fact.

The governing rule is:

> **External representations establish no RITSEI identity, authority, or business fact until they
> cross explicit protocol, runtime-decoding, identity, authorization, and domain boundaries.**

### Boundary rules

1. **Decode at runtime boundaries.** HTTP/RPC payloads, events, files, AI output, partner data,
   internal messages, and serialized database values enter as untrusted data and are decoded with a
   runtime schema or equivalent versioned decoder. A TypeScript assertion is not a decoder.
2. **Grant only the property proved.** Representation, semantic, referential, authorization, and
   domain-invariant validation are distinct. Schema success proves shape and declared value
   semantics only; it does not prove membership, authority, current state, or business truth.
3. **Keep representations, intent, commands, and facts separate.** Vendor formats and AI or
   workflow interpretations stop at their adapter or intent boundary. Only an authorized owner
   command, optionally coordinated by a released deterministic process, may mutate business state.
4. **Do not trust location.** Internal network position, service identity, queue membership, cached
   projections, and database provenance do not bypass decoding, version checks, authorization, or
   owner-domain validation.
5. **Bound hostile work.** Body size, string length, collection cardinality, nesting depth,
   decompression ratio, batch size, timeout, query complexity, and execution budget are part of the
   applicable protocol/resource boundary. Structurally valid input may still be unsafe to process.
6. **Fail closed.** Missing, stale, unknown, invalid, or unavailable security and authority evidence
   cannot become `ALLOW`, a successful command, or an inferred business fact. Unknown is neither
   success nor permission to guess.
7. **Separate machine safety from semantic safety.** Protocol, parser, runtime, memory, and resource
   controls protect the pre-application boundary; runtime schemas, identity, authorization,
   invariants, transactions, and deterministic processes protect semantic authority. Neither layer
   substitutes for the other.

Versioned external adapters may normalize declared vendor semantics into validated integration
values. They must not leak provider representations into domain contracts or bypass the owning public
command.

### AI and interpreter invariant

LLMs, rule interpreters, workflow expressions, scripts, parsers, and integration adapters may
produce candidate observations, intent, or typed input. None may directly create a business fact,
reach a financial ledger, or bypass the owning authorization and transaction path.

## Alternatives Considered

### Treat `unknown` as the security boundary

Rejected. `unknown` is compile-time discipline; the runtime decoder and boundary checks establish
the actual proof.

### Treat schema validation as domain authorization

Rejected. Schema validation is necessary but does not prove identity, membership, authority,
referential existence, current state, or invariants.

### Trust internal services or network locations

Rejected. Internal messages, events, files, and service calls can be stale, malformed, compromised,
or produced by an incompatible version.

### Use one mandatory validation order everywhere

Rejected. Transport and event protocols may authenticate, verify signatures, rate-limit, or decode in
different safe orders. The invariant is explicit coverage before owner command execution, not one
universal middleware sequence.

## Consequences

### Positive

- Trust acquisition becomes explicit from transport representation through business fact.
- AI, integration, workflow, event, and database reconstruction paths use the same authority model.
- Schema, authentication, authorization, domain, and resource failures remain distinguishable.
- Parser-level safety and application-level semantic safety are not conflated.

### Negative

- Boundary adapters need versioned decoders, resource limits, and explicit error mapping.
- Some internal paths require more validation than their network location previously implied.
- Reconstructing serialized state can surface legacy or incompatible data as typed failures.

### Risks

This ADR does not make a parser, runtime, operating system, dependency, or database memory-safe. It
requires those controls to remain explicit and prevents application-level authorization from being
treated as protection against failures that occur below it.

## Validation

Before acceptance, review the existing API, integration, identity, authorization, AI, Process
Studio, plugin, and persistence-boundary documents for alignment with this model. Implementation
validation should demonstrate:

1. runtime decoding and bounded resource checks at each public input boundary;
2. rejection of malformed, oversized, incompatible, unauthenticated, unauthorized, and
   domain-invalid inputs;
3. no direct interpreter, adapter, AI, or projection path to business mutation or financial
   authority;
4. typed failure behavior for unknown or unavailable authority evidence; and
5. preservation of owner-controlled authorization, idempotency, transaction, audit, and deterministic
   process paths.

## Related Documents

- [ADR-0024: Adopt Effect Schema as the canonical contract schema](./0024-adopt-effect-schema-as-canonical-contract-schema.md)
- [ADR-0058: Define provider-neutral identity and authentication boundary](./0058-define-provider-neutral-identity-and-authentication-boundary.md)
- [ADR-0059: Define replaceable relationship authorization engine](./0059-define-replaceable-relationship-authorization-engine.md)
- [ADR-0063: Define governed AI recommendation and agent boundary](./0063-define-governed-ai-recommendation-and-agent-boundary.md)
- [ADR-0083: Enforce non-interference between source-of-truth domains and derived capabilities](./0083-enforce-non-interference-between-source-of-truth-and-derived-capabilities.md)
