# Releasing RITSEI

> **Status:** Canonical release workflow
>
> **Owns:** product release preparation, SemVer authority, source-only release caveats, artifact
> build evidence, and release-record requirements.
>
> **Related documents**
>
> - Product release authority:
>   [`../decisions/0066-adopt-single-product-semver-authority.md`](../decisions/0066-adopt-single-product-semver-authority.md)
> - Capability release governance:
>   [`../decisions/0020-adopt-capability-release-and-runtime-governance.md`](../decisions/0020-adopt-capability-release-and-runtime-governance.md)
> - Commit-message standard: [`./commit-message-guidelines.md`](./commit-message-guidelines.md)
> - Roadmap index: [`../roadmap/README.md`](../roadmap/README.md)
> - Artifact evidence: [`../operations/release-artifact-evidence.json`](../operations/release-artifact-evidence.json)

## Product version authority

RITSEI product releases are annotated Git tags using SemVer: `vX.Y.Z`. The tag and its target commit
are the product release identity. Branch names, package versions, dependency versions, migration
names, and capability versions are not product release authorities.

Curated release notes live in `.github/release-notes/<tag>.md`, the path used by release validation
and publication. Each notes file is committed before its tag is created.

## Release status

Published release records:

| Release  | Source target                                                               | Status                |
| -------- | --------------------------------------------------------------------------- | --------------------- |
| `v0.1.0` | `7befeb495567e926e32ab85a926c96d20c92ec37`, August 13, 2026 01:35:28 +07:00 | Published pre-release |
| `v0.2.0` | `72d233e006faaadee30a57b194b9752b32f79d68`, August 31, 2026                 | Published pre-release |

Both releases were published on August 31, 2026 as pre-release, source-only snapshots. They do not
promise a build artifact, package distribution, production deployment, or supported upgrade path.

The current source tree also provides an artifact-backed build path:

```sh
pnpm run check
pnpm run production:artifacts
```

The command produces reproducible API, worker, migrator, migration, and frontend artifacts under
`deploy/artifacts/output/<source-revision>/` and records their hashes in
`deploy/artifacts/manifest.json`. This path does not itself grant production deployment or profile
approval; those remain separate reviewed gates.

## Preparation checklist

1. Confirm the intended source tip and review the changed files.
2. Confirm the product version is the next intended SemVer tag; do not infer it from a package,
   migration, capability, or dependency version.
3. Update or add `.github/release-notes/vX.Y.Z.md` with curated, historical changes and explicit
   caveats.
4. Run repository checks appropriate to the release. At minimum, validate Markdown links and the
   release notes path when those checks are available.
5. Create an annotated tag only after review, pointing at the exact intended commit:

   ```sh
   git tag -a vX.Y.Z <commit> -m "release vX.Y.Z"
   git show vX.Y.Z
   ```

6. Verify the tag is annotated, resolves to a commit, and matches the notes file before publication.
7. Push the tag to `origin`; the release workflow validates it and publishes a pre-release.

For the historical `v0.1.0` tag, the release workflow uses the current default branch for its
release tooling and curated notes, then publishes the release against the historical tag target.
This keeps the old source snapshot immutable without requiring release automation to exist in that
old commit.

Do not rewrite an existing release tag. Correct a mistaken release with a new release decision and
an explicitly documented replacement process.

## Automated release gate

Run the full release gate with PostgreSQL 19 or newer available:

```sh
pnpm exec varlock run -- pnpm run migrate
pnpm exec varlock run -- pnpm run release:check
```

After creating the annotated tag, validate its metadata locally:

```sh
pnpm run release:metadata vX.Y.Z
```

The gate covers formatting, linting, type checking, migration graph validation, roadmap measurement,
skill validation, boundaries, tests, and Fallow. Open roadmap gates report product/activation
readiness without blocking a source-only release; malformed or contradictory roadmap evidence fails
the gate. The metadata check verifies the annotated tag, target commit, curated notes, and required
pre-release/migration caveats.

## Migration and upgrade caveats

A product tag is a source snapshot, not a database upgrade promise. Before using a release against
data or an existing deployment:

- review the migration graph and required PostgreSQL version;
- rehearse migrations and rollback/manual-recovery procedures on a copy of the target data;
- verify package, API, capability, and Process Studio compatibility separately;
- preserve backups and reconciliation evidence for invariant-sensitive data;
- treat missing build artifacts, deployment manifests, and documented upgrade automation as a reason
  to stop rather than infer support;
- retain `deploy/artifacts/manifest.json` and the generated artifact output together for an
  artifact-backed release.

No automatic compatibility claim follows from `v0.1.0` or `v0.2.0`. Migration and upgrade support
must be documented explicitly when it becomes available.

## Release notes requirements

Each notes file should contain:

- the tag and source target status;
- a short curated summary of user-relevant changes;
- notable constraints or intentionally deferred scope;
- pre-release/source-only and no-build-artifact caveats;
- migration and upgrade caveats;
- references to the canonical roadmap or architecture documents where useful.

The notes summarize history; they do not replace architecture documents or capability contracts.
