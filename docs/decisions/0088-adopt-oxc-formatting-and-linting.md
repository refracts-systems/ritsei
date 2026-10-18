# ADR-0088: Adopt Oxc Formatting and Linting

- Status: Accepted
- Date: 2026-10-18
- Amends: None
- Compatible with: ADR-0087 (Node.js LTS and pnpm toolchain)
- Supersedes: ADR-0087's formatting and linting selection only

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Repository rules: [`../../AGENTS.md`](../../AGENTS.md)
> - Architecture specification: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)

## Context

The Node.js and pnpm migration selected dprint for formatting and retired Deno linting. The
repository now needs a native, Node-installed formatter and linter that share one local toolchain,
work in CI and editors, and preserve the existing formatting exclusions and boundary checks.

There is no ESLint dependency or ESLint configuration in the repository. Oxlint therefore adds the
repository's first general-purpose JavaScript and TypeScript lint gate; it does not migrate an
existing ESLint rule set.

## Decision

1. Use `oxfmt` for JavaScript, TypeScript, JSX, TSX, and JSON formatting.
2. Preserve the existing style contract: two-space indentation, 100-column width, double quotes,
   and ASI/no semicolons.
3. Use `oxlint` as the general-purpose lint gate, initially enforcing its correctness category.
   TypeScript remains the canonical type-checking gate, and ast-grep, architecture checks, and
   Fallow retain ownership of repository-specific boundary and graph rules.
4. Install both tools as exact root dev dependencies and invoke them through root `package.json`
   scripts and CI.
5. Keep generated files, vendored sources, build output, and migration snapshots outside the
   formatter and linter scope.

## Alternatives Considered

- Keep dprint and add ESLint: rejected because it retains two formatting/linting ecosystems and
  introduces ESLint even though no ESLint configuration currently exists.
- Use Prettier plus ESLint: rejected because the selected Oxc tools provide the requested native
  formatter/linter pair and avoid adding a second formatter dependency.
- Enable type-aware Oxlint immediately: deferred because `tsc` already owns type checking and a
  later type-aware linting decision should follow measured findings.

## Consequences

### Positive

- Formatting and linting use one local Oxc toolchain in pnpm, CI, and VS Code.
- The existing Node.js runtime and repository dependency ownership remain unchanged.
- Oxlint adds a dedicated lint gate without replacing repository-specific architecture checks.

### Negative

- Oxfmt may produce formatting changes that do not exactly match dprint; the migration requires a
  reviewed formatting-only diff.
- Oxlint introduces a new baseline of correctness findings that must be resolved or narrowly
  configured before the gate is enabled.

### Risks

- Tool releases may change formatting or rule behavior; exact versions and the lockfile are
  committed to keep local and CI results reproducible.
- Oxfmt and Oxlint support different rule/configuration surfaces than Deno tooling; no implicit
  one-to-one ESLint parity is claimed.

## Validation

The migration is complete only when formatting, Oxlint, type checking, boundary checks, Fallow, the
full test suite, and the Nix flake check pass with the new scripts and lockfile.
