---
name: create-domain-module
description: "Use when adding a new modules/<domain> capability, assigning a new schema owner, or when a request says to create a domain such as supplier contracts, fulfillment, settlement, or evidence."
---

# Purpose

Create the smallest RITSEI domain package with explicit semantic ownership, a public Effect contract, protected persistence, and enforceable boundaries.

# Use This Skill When

- adding a new directory under `framework/modules/`, `erp/modules/`, or `extensions/`;
- introducing a new authoritative business capability or PostgreSQL schema owner;
- a traditional feature must be split into an orthogonal capability;
- the request says “add a domain/module for …”.

# Do Not Use This Skill When

- extending an existing owner; use the relevant schema, contract, API, or transaction skill;
- adding a frontend feature or external adapter without a new domain owner;
- ownership is still ambiguous.

# Required Context

Inspect first:

- the closest implemented module, usually [`erp/modules/party`](../../../erp/modules/party/mod.ts), [`erp/modules/inventory`](../../../erp/modules/inventory/mod.ts), or [`erp/modules/accounting`](../../../erp/modules/accounting/mod.ts);
- [`db/ownership.toml`](../../../db/ownership.toml);
- the semantic-owner and module-contract rules in the canonical architecture;
- related ADRs and the affected composite process.

# Architecture Rules

- One business invariant has one authoritative domain owner.
- Other packages import only the new package’s `mod.ts` public contract.
- Public exports may contain commands, queries, Effect services, tagged errors, Effect Schema DTOs, and layers—not Drizzle tables or repositories.
- A package may import only its owned persistence tables.
- Dependencies must remain acyclic.
- Do not add empty factories, generic repositories, or speculative extension points.

# Workflow

## 1. Inspect

Find the nearest domain implementation and its contract tests. Identify existing owners for every fact the proposed package touches.

## 2. Decide

Record the capability’s responsibility, owned facts, invariants, public operations, failures, dependencies, and whether it truly needs a schema, capability, API endpoint, event, or worker.

If this changes a difficult-to-reverse boundary or source of truth, create an ADR before implementation.

## 3. Implement

For an `erp/` module, start with `pnpm run ritsei new module <name>` (ADR-0094). It creates the
manifest, an empty service contract, layers, and a contract test, and registers the module in
`erp/runtime/modules.ts`. It decides nothing for you: declare dependencies, owned schemas,
capabilities, released actions and events, consumed events, HTTP groups, and pages in `manifest.ts`
as you add each one. Otherwise create only the files required now:

```text
<root>/<domain>/manifest.ts
<root>/<domain>/mod.ts
<root>/<domain>/src/...
<root>/<domain>/tests/...
```

If persistence is required, compose with `change-schema`. If another domain must consume it, compose with `add-capability` and `cross-domain-and-transactions`. Add API and authorization surfaces only when requested.

## 4. Validate

Run focused contract tests first, then repository policy checks.

# Deterministic Tools

```sh
pnpm run skills:check
pnpm run boundary:test
pnpm run boundary:lint
pnpm run check:affected
pnpm run check
```

Use `pnpm run db:generate` and `pnpm run db:check` only when the domain owns persistence changes. The generator scaffolds structure only; capabilities, tables, transitions, and cross-module consequences stay explicit decisions. `tests/architecture/modules.test.ts` fails when the manifest drifts from the code.

# Required Checks

- public tests import only `modules/<domain>/mod.ts`;
- ownership registry and migration checks pass when persistence is added;
- package dependency graph remains acyclic;
- every public tagged failure and authorization path is tested;
- documentation or ADRs are updated only at their canonical owner.

# Failure Conditions

Stop and report instead of guessing when:

- two domains plausibly own the same invariant;
- the design requires direct writes to another domain’s tables;
- a dependency cycle appears;
- cross-domain atomicity requires a transaction-aware contract that does not exist;
- the requested module is only a speculative placeholder.

# Completion Criteria

The package has one clear responsibility, an explicit public entry point, no leaked persistence types, the minimum required tests, registered ownership where applicable, and all deterministic checks pass.

# Related Skills

- [`change-schema`](../change-schema/SKILL.md)
- [`add-capability`](../add-capability/SKILL.md)
- [`cross-domain-and-transactions`](../cross-domain-and-transactions/SKILL.md)

# References

- [`AGENTS.md`](../../../AGENTS.md)
- [Architecture specification](../../../docs/architecture/architecture-spec-v4.md)
- [Architecture enforcement](../../../docs/architecture/architecture-enforcement.md)
- [ADR-0015: one semantic owner](../../../docs/decisions/0015-one-semantic-owner-per-invariant.md)
- [Testing strategy](../../../docs/development/testing.md)
