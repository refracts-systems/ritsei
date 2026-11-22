# ast-grep rules

Fallow owns generic repository-wide graph checks: import zones, circular dependencies, dead code,
duplication, and complexity. Its policy pack also carries the generic Effect-version, test-runner,
and frontend dependency rules in `../fallow/rules/ritsei-static-policy.json`.

RITSEI-specific checks remain small and explicit:

- these `ast-grep` rules protect syntax-level policies such as private re-exports, UUID use, and
  opening browser-test dialogs through `openedDialog`, and `no-dev-financial-signer-in-production`, which lets only tests import the development Ed25519
  signer, and `untagged-todo`, which rejects a
  TODO, FIXME, HACK, or XXX comment that does not carry a tag such as `TODO(financial-prod)`;
- `../schema-ownership.ts` validates `db/ownership.toml`, migration headers, and schema ownership;
- `../architecture.ts` validates the remaining path-sensitive public-package, frontend, and AI
  boundaries.

Install the CLI once:

```sh
cargo install ast-grep --locked
```

Run:

```sh
deno task boundary:test
deno task boundary:lint
```
