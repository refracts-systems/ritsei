---
name: add-capability
description: "Use to add or change a RITSEI business capability end to end: a terse ERP request (add warehouse transfers, tambahkan fitur retur pembelian), a new command/query/tagged error in a module's public contract, a protected business action or authorization capability, or an HTTP endpoint in runtime/api."
---

# Purpose

Deliver the smallest complete, repository-compliant capability by copying the nearest existing
neighbor and implementing only the delta. Covers contract, errors, service, authorization, and HTTP.

# Do Not Use When

- the change is mechanical (rename, typo, formatting, dependency bump) or has no business behavior;
- only tables or migrations change → `change-schema`;
- the work is only cross-domain wiring or a multi-write invariant → `cross-domain-and-transactions`.

# 1. Scope from evidence

- Restate the request as one business-capability sentence: objects, actors, commands, state change.
- Find the **nearest existing capability by business effect** and use its layout, error style,
  authorization, transaction style, API style, and tests as the template. Record only the delta.
- Implement what the request, repository architecture, ADRs, or a concrete correctness consequence
  require. "Enterprise ERPs usually do this" is not evidence. Leave optional behavior (approvals,
  notifications, documents, accounting entries, events, lots, valuation) out unless required, and
  surface material unknowns instead of guessing. Never invent legal, tax, or jurisdiction rules.
- A new primitive (domain, layer, event mechanism, workflow engine, authorization mechanism) needs
  an ADR; prefer the existing paved road.

# 2. Contract and errors (`modules/<domain>`)

- Follow the feature shape in [`AGENTS.md`](../../../AGENTS.md#default-effect-feature-shape).
  Public surface is Effect Schema DTOs, an Effect service, commands/queries, tagged errors, layers.
  Export only what callers need from `mod.ts`; never tables, repositories, or Drizzle types.
- Add an error only if a domain caller can act on it; map known constraints to owning-domain errors
  and unknown persistence failures once to `DatabaseFailure`.
- If the feature has states, write the transition table first: precondition, effect, capability,
  duplicate-request behavior. Reject invalid transitions explicitly.
- Inspect every current importer of the package before changing an exported schema or failure union.
- Cover the contract with tests that import only `mod.ts`.

# 3. Authorization

- Name capabilities `<domain>.<resource>.<action>` (business action, not CRUD); add the literal to
  the closed registry in `modules/authorization`. Deny by default, tenant/scope aware.
- Enforce in the owning backend service or handler before any read/mutation, on every entry path.
  Frontend visibility is UX only.
- Test allow, default-deny, and scope-mismatch. Test layers must not bypass authorization.
- Audit package and production RLS paths are not implemented: report that gap for high-risk actions
  rather than faking either.

# 4. HTTP (`runtime/api`)

- Add the endpoint to its `HttpApiGroup` in `api.ts`; keep the handler in `handlers.ts` thin: obtain
  context, call the public service. Wire a new service layer in `mod.ts` only if missing.
- Decode with Effect Schema, protect with the bearer middleware, map domain errors to stable
  transport errors without persistence details.
- Extend the OpenAPI/route test. Consult `vendor/effect` before changing HttpApi or Layer code.
  Folder rules: [`runtime/api/AGENTS.md`](../../../runtime/api/AGENTS.md).

# 5. Prove invariants and validate

For each important invariant pick one proof: database constraint, domain test, contract test,
rollback test, or concurrency test. Do not add test categories that prove nothing.

```sh
pnpm run check:affected
pnpm run boundary:test
pnpm run boundary:lint
pnpm run check
```

Also run `pnpm run db:check` when schema changed. Update the canonical doc owner (or add an ADR)
when a contract, ownership, or consistency rule changed.

# Stop and report when

Sources conflict, no domain can own the invariant, the only path is a cross-domain table write,
a retryable effect has no idempotency strategy, or a material business decision is unknown.

# Related

[`change-schema`](../change-schema/SKILL.md),
[`cross-domain-and-transactions`](../cross-domain-and-transactions/SKILL.md),
[`design-effect-program`](../design-effect-program/SKILL.md),
[`create-domain-module`](../create-domain-module/SKILL.md). References: ADR-0006
(authorization), ADR-0012 (Effect HTTP), `docs/architecture/authorization.md`,
`docs/architecture/architecture-enforcement.md`, `docs/development/testing.md`.
