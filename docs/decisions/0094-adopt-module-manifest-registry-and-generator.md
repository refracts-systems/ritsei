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
3. **The registry is generated from the manifests.** Following the TanStack Router generator,
   `pnpm run ritsei gen` rebuilds whole files from conventions instead of editing hand-written ones.
   It loads every `erp/modules/*/manifest.ts` with jiti and writes two committed, oxfmt-formatted
   files: `erp/runtime/modules.gen.ts` (installed manifests, HTTP groups, and handler layers as
   static imports, so `RitseiApi` and `ApiHandlers` stay fully typed) and
   `apps/web/src/app/routes.gen.ts` (lazy routes for every manifest page and the home-directory
   workspaces). `ritsei gen --check` and a freshness test fail when either file is stale.
   `validateModuleRegistry` checks names, dependencies (known and acyclic), capability, action, and
   event prefixes, action capabilities, single ownership of schemas, capabilities, HTTP groups, and
   pages, and that every consumed event is released by a declared dependency.
4. **Manifests must match the repository.** An architecture test checks that every module directory
   is registered under its own name, that declared schemas equal its `db/ownership.toml` entries,
   that production imports of other `erp/` modules are declared dependencies, and that declared HTTP
   groups are defined in the module's `http.ts`. A manifest that drifts from the code fails the
   suite.
5. **The generator scaffolds structure; `--entity` adds one explicit record.** `pnpm run ritsei new
   module <name>` creates a manifest, an empty service contract, layers, and a contract test.
   `--entity <entity>` opts into one tenant-scoped record with a unique name: a Drizzle table and its
   migration, PostgreSQL and memory stores, an authorized service, an HTTP list and create endpoint,
   a page with a create dialog, and contract and HTTP tests. It declares `<module>.<entity>.read`
   and `.create` capabilities in the manifest and the closed authorization catalog; they are deny by
   default and take effect only when a tenant administrator grants them, so no authorization policy
   is generated silently (amending ADR-0046's generated-tooling rule only to this extent). The
   generated migration carries the owner, review-date, and generator headers, and its SQL must be
   reviewed before it is committed. Business transitions, cross-module consequences, and grants are
   never generated.
6. **Versioning follows the product.** Modules carry no independent version while they ship with the
   product (ADR-0066). Released actions and events keep their own contract versions.
7. **A module owns its HTTP adapter; pages stay in the web app.** Each module defines its HttpApi
   group, handlers, and error mapping in `http.ts`, built on the shared `framework/modules/http`
   kernel (principal, bearer middleware, transport errors, common schemas, error mapping). `http.ts`
   is a second public entry that only `erp/runtime`, tests, and tooling may import. Page components
   stay in the web app at `apps/web/src/app/modules/<module>.tsx`, with a `<module>.workspace.ts`
   sidecar for the home directory, because ADR-0049 keeps the Solid compiler at the web boundary and
   ADR-0075 keeps web dependencies in `apps/web`; the manifest lists each page's paths.
8. **Hand-written composition is edited precisely.** Files that remain hand-written (the closed
   capability catalog, the Drizzle Kit schema filter, `db/schema/index.ts`, `erp/runtime/layers.ts`,
   `db/ownership.toml`) are edited by `--entity` with magic-string at offsets found through the
   TypeScript AST, leaving every other byte unchanged; oxfmt then normalizes the inserted lines.
   jiti 2.7.0 and magic-string 0.30.21 are exact root devDependencies for this tooling only.

## Alternatives Considered

- **A data file (JSON or TOML) manifest:** rejected; it would restate capability and catalog constants
  as strings that can drift. A typed manifest references the real constants.
- **Keep `framework/modules/catalog` separate:** rejected; released actions and events are what a
  manifest declares, and two homes for released contracts would invite drift.
- **Insert lines into hand-written composition files:** rejected for the registry and routes;
  line-based edits are fragile and hide drift. Whole generated files are checked for freshness.
- **Discover modules at runtime:** rejected; dynamic discovery loses the static types `HttpApi` and
  `Layer` composition rely on.
- **Generate capabilities silently:** rejected; `--entity` capabilities are explicit, visible in the
  manifest and the catalog, and deny by default.

## Consequences

### Positive

- A module's footprint is readable in one file and checked against the code.
- Undeclared cross-module imports and schema-ownership drift fail the test suite.
- A generated entity module migrates, serves an authorized endpoint, and renders a page without
  hand edits, which meets framework reset Phase 3's exit criterion.

### Negative

- Every module carries one more file that must change with its capabilities, catalogs, routes, and
  pages; the architecture test makes forgetting it visible rather than silent.
- Two committed generated files must be regenerated when a manifest changes.
- The shell's sidebar navigation is still hand-written, so a generated module appears in the home
  directory but not in the sidebar until that is designed.

### Risks

- Manifests could grow into a configuration language. Containment: fields are added only when a
  module uses them and the registry checks them.
- A generated migration could be committed unreviewed. Containment: the CLI tells the developer to
  review it, and the migration headers record who reviewed it and when.

## Validation

- `tests/architecture/modules.test.ts` passes for every installed module, and fails when a manifest
  drifts from imports, schema ownership, or HTTP groups.
- `tests/architecture/codegen.test.ts` fails when a generated file is stale.
- `tests/architecture/module-generator.test.ts` and `entity-generator.test.ts` check the scaffolds
  and every hand-written-file edit against the real sources.
- A module generated with `ritsei new module <name> --entity <entity>` typechecks, lints, passes
  formatting, its contract and HTTP tests, Drizzle Kit `check`, the ownership and module checks,
  fallow, the web check and build, and a browser test of its page, without hand edits.

## Related Documents

- [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
- [`../../.agents/skills/create-domain-module/SKILL.md`](../../.agents/skills/create-domain-module/SKILL.md)
