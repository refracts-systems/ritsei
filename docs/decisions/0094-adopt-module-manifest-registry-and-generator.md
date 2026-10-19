# ADR-0094: Adopt the Module Manifest, Registry, and Generator

- Status: Accepted
- Date: 2026-10-19
- Amends: ADR-0046 (the generator scaffolds a module's structure, never its business decisions)
- Compatible with: ADR-0015, ADR-0066, ADR-0068, ADR-0091
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Framework and flagship ERP decision:
>   [`./0091-adopt-framework-and-flagship-erp.md`](./0091-adopt-framework-and-flagship-erp.md)
> - Framework reset Phase 3: [`../proposals/framework-reset.md`](../proposals/framework-reset.md#8-phases)
> - ERP parity plan, decision D8: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - Owner-local surface and generated ergonomics:
>   [`./0046-adopt-owner-local-business-surface-and-generated-ergonomics.md`](./0046-adopt-owner-local-business-surface-and-generated-ergonomics.md)

## Context

ADR-0091 makes every flagship capability a module built the way third-party modules will be, and
framework reset Phase 3 asks for a module manifest, a registry, and a `ritsei new module` generator.
Today a module's shape is implicit: its owned schema lives in `db/ownership.toml`, its capabilities
and released actions and events in `src/capabilities.ts` and `src/catalog.ts`, its dependencies in
import statements, and its HTTP group and web page in `erp/runtime` and `apps/web`. Nothing states
them in one place or checks that they agree. `framework/modules/catalog` already holds the shared
shape of released action and event contracts, which is the same concept as ADR-0091's released,
versioned contracts.

## Decision

1. **One manifest per module.** Each module has `manifest.ts` next to `mod.ts`, built with
   `defineModule` and exported from `mod.ts`. It declares the module's name and layer, the `erp/` or
   `extensions/` modules it depends on, the PostgreSQL schemas it owns, its capabilities, the actions
   and events it releases, the events it consumes, its HTTP API groups, and its web pages. It
   references the module's existing constants (capability object, action and event catalogs) instead
   of restating them. Framework modules are always available to `erp/` and `extensions/` and are not
   listed as dependencies.
2. **The catalog folds into the module kernel.** `framework/modules/catalog` moves to
   `framework/modules/module`, which owns the released-contract shapes (actions, events) and the
   manifest and registry. A manifest's actions and events are its released contracts. Extension points
   join the manifest when the first one is released, not before.
3. **The composition root is the registry.** `erp/runtime/modules.ts` lists the installed modules.
   `validateModuleRegistry` checks names, dependencies (known and acyclic), capability, action, and
   event prefixes, action capabilities, schema uniqueness, and that every consumed event is released
   by a declared dependency.
4. **Manifests must match the repository.** An architecture test checks that every module directory
   is registered under its own name, that declared schemas equal its `db/ownership.toml` entries, that
   production imports of other `erp/` modules are declared dependencies, and that declared API groups
   and pages exist. A manifest that drifts from the code fails the suite.
5. **The generator scaffolds structure only.** `pnpm run ritsei new module <name>` creates a module
   with a manifest, an empty service contract, layers, and a contract test, and registers it in
   `erp/runtime/modules.ts`. Following ADR-0046, it does not generate capabilities, business
   transitions, cross-module consequences, tables, or authorization grants; each is added explicitly
   with the existing skills.
6. **Versioning follows the product.** Modules carry no independent version while they ship with the
   product (ADR-0066). Released actions and events keep their own contract versions.
7. **A module owns its HTTP adapter; pages stay in the web app.** Each module defines its HttpApi
   group, handlers, and error mapping in `http.ts`, built on the shared `framework/modules/http`
   kernel (principal, bearer middleware, transport errors, common schemas, error mapping). `http.ts`
   is a second public entry that only `erp/runtime`, tests, and tooling may import; the runtime
   composes the groups into `RitseiApi`. Pages stay in `apps/web/src/features/<module>` because
   ADR-0049 keeps the Solid compiler at the web boundary and ADR-0075 keeps web dependencies in
   `apps/web`; the manifest declares each page's route.

## Alternatives Considered

- **A data file (JSON or TOML) manifest:** rejected; it would restate capability and catalog constants
  as strings that can drift. A typed manifest references the real constants.
- **Keep `framework/modules/catalog` separate:** rejected; released actions and events are what a
  manifest declares, and two homes for released contracts would invite drift.
- **A generator that also emits capabilities, tables, and routes:** rejected for now; ADR-0046 forbids
  silently generated authorization and business behavior, and routes cannot be generated until they
  live in the module.

## Consequences

### Positive

- A module's footprint is readable in one file and checked against the code.
- Undeclared cross-module imports and schema-ownership drift fail the test suite.
- New modules start from the same shape as the flagship modules.

### Negative

- Every module carries one more file that must change with its capabilities, catalogs, routes, and
  pages; the architecture test makes forgetting it visible rather than silent.
- Phase 3's exit criterion is only partly met until routes and pages move into modules.

### Risks

- Manifests could grow into a configuration language. Containment: fields are added only when a
  module uses them and the registry checks them.

## Validation

- `tests/architecture/modules.test.ts` passes for every installed module, and fails when a manifest
  drifts from imports, schema ownership, routes, or pages.
- `tests/architecture/module-generator.test.ts` checks the scaffold and its registration.
- A module generated with `pnpm run ritsei new module` typechecks, lints, passes its own contract
  test, and passes the registry check without edits.

## Related Documents

- [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
- [`../../.agents/skills/create-domain-module/SKILL.md`](../../.agents/skills/create-domain-module/SKILL.md)
