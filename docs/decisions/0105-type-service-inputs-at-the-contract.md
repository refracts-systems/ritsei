# ADR-0105: Type Service Inputs at the Contract

- Status: Accepted
- Date: 2026-10-21
- Amends: None
- Compatible with: ADR-0024, ADR-0048, ADR-0094
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Anti-slop rule decisions: [`../proposals/anti-slop-deferred-rules.md`](../proposals/anti-slop-deferred-rules.md)
> - Vendored rule provenance: [`../../tooling/oxlint/anti-slop/UPSTREAM.md`](../../tooling/oxlint/anti-slop/UPSTREAM.md)

## Context

Service operations accept `input: unknown` and decode it with an Effect Schema inside the
service. The decode keeps every caller, HTTP or not, behind the same validation, but the service
contract states no input type: a renamed field or a new required field compiles at every call
site and fails only at runtime. The vendored `anti-slop/no-unknown-parameters` rule reports 668
such parameters.

Two ways to type the input were considered:

- **Typed signature, decode kept (stage A).** The parameter type is the schema's encoded type.
  Callers get compile-time checks; the service still decodes, so refinements that the type cannot
  express (amounts, quantities, length limits, uniqueness) are still enforced at runtime.
- **Validated class instance (stage B).** Each input becomes a `Schema.Class` with a private
  marker, so only a constructed, validated instance satisfies the parameter type, and the service
  stops decoding. This removes the second decode and `Schema.SchemaError` from service failure
  unions, but every call site must construct the instance, and tests of invalid input move to the
  constructor or the HTTP handler.

## Decision

1. **Service parameters are typed with the encoded type of the schema that decodes them**:
   `(input: Schema.Codec.Encoded<typeof CreateTaxCodeInput>)`, in both the service interface and
   its implementation. The service keeps decoding, so runtime validation is unchanged.
2. **Pass-through wrappers reuse the contract type** (`Parameters<typeof service.op>[0]`) instead
   of restating it.
3. **Tests that deliberately send invalid input** build it with `partial<T>()`
   (`tests/support/partial.ts`), so the intent is visible at the call site.
4. **Migration runs module by module.** `no-unknown-parameters` is enabled with an `overrides`
   block that turns it off only for directories not yet migrated; each module's commit removes its
   entry, and the block disappears with the last one.
5. **Stage B is the target, not part of this decision.** It needs its own ADR once stage A is
   complete, because it changes what a service may assume about its input.

## Consequences

- Call sites are checked by the compiler; schema changes surface as type errors.
- Each HTTP request is still decoded twice (HttpApi payload, then the service); internal calls
  still decode once. `Schema.SchemaError` stays in service failure unions.
- Test doubles that implement a service interface must accept the typed input.

## Alternatives Considered

- **Keep `unknown` and the rule off:** rejected; the contract would keep hiding its input.
- **Plain `Schema.Type` parameters without decoding:** rejected; refinements are erased at the type
  level, so callers could pass values the schema rejects.
- **Stage B directly:** deferred; it rewrites every call site at once and changes failure unions,
  which is better done after stage A has made every input type explicit.
