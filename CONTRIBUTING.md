# Contributing

> **Related documents**
>
> - Agent and repository rules: [`./AGENTS.md`](./AGENTS.md)
> - Documentation index: [`./docs/README.md`](./docs/README.md)
> - Commit-message standard: [`./docs/development/commit-message-guidelines.md`](./docs/development/commit-message-guidelines.md)
> - Release workflow: [`./docs/development/releasing.md`](./docs/development/releasing.md)
> - ADR index: [`./docs/decisions/README.md`](./docs/decisions/README.md)

## Workflow

1. Read `AGENTS.md`.
2. Read the architecture document relevant to the change.
3. Check related ADRs.
4. Keep the change narrowly scoped.
5. For release preparation, follow the [release workflow](./docs/development/releasing.md) and keep the annotated product tag as the sole SemVer authority.
6. Add or update tests.
7. Run all available validation.
8. Update documentation when behavior or architecture changes.
9. Follow the [commit-message standard](./docs/development/commit-message-guidelines.md).

## Commit messages

Use the [commit-message standard](./docs/development/commit-message-guidelines.md)
for every commit created in this repository. After installing dependencies, run
`pnpm run lefthook:install` to enable the local formatter and commit-message checks.

## Pull Request Checklist

- [ ] The scope is clear and contains no unrelated refactor.
- [ ] Module ownership is preserved.
- [ ] Business failures remain typed and exhaustive.
- [ ] Transactions and invariants were reviewed.
- [ ] Authorization and tenant isolation were reviewed.
- [ ] Tests cover behavior, edge cases, and failure paths.
- [ ] Documentation was updated or marked unnecessary.
- [ ] Commit messages follow the repository standard.
- [ ] An ADR was added when architecture changed.
- [ ] No secrets or sensitive data were introduced.
