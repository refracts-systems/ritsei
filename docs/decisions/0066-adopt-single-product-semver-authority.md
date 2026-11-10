# ADR-0066: Adopt a Single Product SemVer Authority

- Status: Accepted
- Date: 2026-08-31
- Amends: None
- Compatible with: ADR-0020
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Release workflow: [`../development/releasing.md`](../development/releasing.md)
> - Capability release governance:
>   [`./0020-adopt-capability-release-and-runtime-governance.md`](./archive/0020-adopt-capability-release-and-runtime-governance.md)
> - Roadmap index: [`../roadmap/README.md`](../roadmap/README.md)

## Context

RITSEI has product, package, capability, database, and dependency versions. Without one product
authority, a release can be described inconsistently by a Git ref, release notes, package metadata,
or a capability version. The project also needs a safe way to publish early source snapshots while
the runtime and migration surface remain under active development.

## Decision

The single product release authority is an annotated Git tag matching `vX.Y.Z`.

- Product versions use Semantic Versioning and are represented by the annotated tag, for example
  `v0.1.0`.
- The tag target commit is the immutable source snapshot for that release.
- Curated notes are stored at `.github/release-notes/vX.Y.Z.md` and must describe the same tag
  target.
- A release is pre-release and source-only until a later decision explicitly establishes supported
  build artifacts and distribution channels.
- Package, dependency, database migration, API, and Process Studio capability versions may have
  their own compatibility rules. They do not establish the product version and must not be used as
  substitute product authorities.
- Release preparation must not invent historical tag targets. A pending release records its intended
  tag and current release-preparation tip until the annotated tag is created.

The release process is documentation and source-history driven: validate the annotated tag, verify
its target, review the curated notes, and state migration and upgrade limitations before
publication.

## Alternatives Considered

### Package metadata as the product authority

Rejected. RITSEI is a multi-package repository, and package metadata cannot unambiguously identify
the complete product source snapshot.

### Release notes or a branch name as the authority

Rejected. Notes are descriptive and branches move; neither provides an immutable product identity.

### Capability versions as product versions

Rejected. Capability release governance is intentionally finer-grained than a product release and is
owned by the relevant domain contract.

## Consequences

### Positive

- Every product release has one immutable, reviewable source identity.
- Release tooling, notes, and contributor guidance can use the same authority.
- Source-only pre-releases can be published without implying binary support.
- Domain and migration compatibility remains explicit instead of being hidden behind a product
  version.

### Negative

- Annotated tags and curated notes are required release records.
- Product releases do not automatically resolve package or migration upgrades.
- Build artifacts and distribution provenance remain future work.

### Risks

- A tag may be created from an insufficiently reviewed commit.
- Notes may omit migration or operational caveats.
- Consumers may mistake a source-only pre-release for production support.

## Validation

A release is ready for publication when the tag is an annotated `vX.Y.Z` tag, its target is the
intended commit, matching curated notes exist, and the notes state pre-release/source-only status
plus migration and upgrade caveats.

## Related Documents

- [`../development/releasing.md`](../development/releasing.md)
- [`../roadmap/README.md`](../roadmap/README.md)
- [`./0020-adopt-capability-release-and-runtime-governance.md`](./archive/0020-adopt-capability-release-and-runtime-governance.md)
