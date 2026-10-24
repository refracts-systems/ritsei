# ADR-0106: Validate Service Inputs Once with Schema Classes

- Status: Proposed
- Date: 2026-10-24
- Amends: None
- Compatible with: ADR-0024, ADR-0048, ADR-0094, ADR-0105
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR-0105, stage A: [`./0105-type-service-inputs-at-the-contract.md`](./0105-type-service-inputs-at-the-contract.md)
> - Vendored rule provenance: [`../../tooling/oxlint/anti-slop/UPSTREAM.md`](../../tooling/oxlint/anti-slop/UPSTREAM.md)

## Context

ADR-0105 types every service parameter with the encoded type of its input schema and keeps the
decode inside the service. That was stage A. It left three costs, which ADR-0105 listed as the
reason stage B needed its own decision:

- An HTTP request is decoded twice: once by the `HttpApi` payload schema, once by the service.
- `Schema.SchemaError` stays in the failure union of operations whose input the caller already
  validated, so a caller cannot take a business action for it (see "Failure Ownership" in
  `AGENTS.md`).
- The encoded type accepts any value of the right shape, so the compiler cannot tell a validated
  input from a raw one. Tests that send invalid input need `partial<T>()` to get past the type.

The repository has about 30 `decodeUnknownEffect` calls at service entry points and about 20 files
that use `partial<T>()`. Those counts bound the change.

## Decision

Pilot stage B in one module before adopting it anywhere else.

1. **Pilot module: `tax`.** It is small, three modules call it (`sales`, `billing`, `procurement`), and its inputs are
   plain fields with refinements, so the pilot also tests the cross-module construction path.
2. **Shape.** Each input of the pilot is a `Schema.Class`. The service parameter type is the class
   instance, so only a constructed, validated value satisfies it. The service stops decoding that
   input and drops `Schema.SchemaError` from the operation's failure union. Construction sites
   (HTTP handler, other modules, tests) call the class constructor or `Schema.decodeUnknownEffect`
   on the class and own the `SchemaError`.
3. **Decide after the pilot, with measurements.** The pilot's PR reports: lines changed at call
   sites, failure unions that lost `SchemaError`, tests that no longer need `partial<T>()`, and any
   place where a refinement could not be expressed on the class. The ADR then moves to Accepted for
   all modules, is amended for the cases the pilot found, or is rejected with the evidence.
4. **No change elsewhere meanwhile.** The other modules keep stage A. The rule
   `no-unknown-parameters` stays satisfied by both shapes.

## Consequences

- If accepted, a service contract states that its input is already valid, and the second decode and
  `SchemaError` disappear from internal calls.
- Every call site in a migrated module constructs an instance; a module cannot be migrated halfway
  without its callers being migrated with it.
- Tests of invalid input move to the class constructor or the HTTP handler, where the validation now
  lives.
- A `Schema.Class` instance is not a plain object. Anything that serializes or spreads inputs (job
  payloads, idempotency keys, audit records) must encode through the schema, not `JSON.stringify`.

## Alternatives Considered

- **Stay at stage A:** keeps the double decode and `SchemaError` in every union; acceptable, and the
  fallback if the pilot shows no benefit worth the call-site cost.
- **Branded types instead of classes:** a brand marks a validated value without a class, but each
  input would still need a constructor function and a decode, so the cost is the same with less
  structure.
- **Migrate all modules at once:** rejected; it repeats the 668-site rewrite of ADR-0105 without
  evidence that the result is better.
