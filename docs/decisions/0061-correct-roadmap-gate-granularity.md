# ADR-0061: Require Executable Evidence for Roadmap Gate Completion

- Status: Accepted
- Date: 2026-08-27
- Amends: None
- Compatible with: ADR-0018, ADR-0019, ADR-0020
- Supersedes: None
- Superseded by: ADR-0089 (mechanical aggregator only)

> **Related documents**
>
> - Roadmap index: [`../roadmap/README.md`](../roadmap/README.md)
> - Domain maturity: [`../roadmap/domain-maturity.md`](../roadmap/domain-maturity.md)
> - Process Studio: [`../roadmap/process-studio.md`](../roadmap/process-studio.md)
> - External integration surface: [`../roadmap/integration-surface.md`](../roadmap/integration-surface.md)
> - Roadmap completion prompt: [`../../.auto/prompt-roadmap-completion.md`](../../.auto/prompt-roadmap-completion.md)

## Context

The roadmap-completion experiment initially treated the presence of source and test marker strings
as completion of entire Process Studio and external-integration phases. That measurement was too
coarse: the repository contained useful contract kernels, but not the durable persistence,
release-validation, transport, deployment, or operational evidence required by the canonical exit
gates.

Runs `#606` through `#620` therefore demonstrated useful bounded implementation work but could not
honestly prove that the corresponding roadmap phases were complete. The benchmark must not reward a
stub, a marker-only test, or a documentation claim that bypasses the canonical phase requirements.

## Decision

1. The roadmap completion registry counts only frozen, canonical exit gates, not arbitrary file or
   marker additions.
2. A gate that requires implementation must require both evidence artifacts and an executable check
   such as a focused test, a machine-readable readiness evaluator, or a repository validation
   command.
3. Contract kernels are not phase completion. Process catalog, runtime, operator, and external
   integration code may remain useful partial foundations while their full roadmap gates stay open.
4. Process and integration phase gates are dependency-ordered. A later phase cannot pass while an
   earlier gate is incomplete.
5. The global exit gate depends on every registered roadmap gate, including financial operational
   evidence and Process Studio/integration phases.
6. The corrected benchmark gets a transparent new baseline. Prior measurements remain append-only
   history and are not relabeled or deleted.

The current canonical roadmap and architecture statuses remain authoritative. This ADR corrects the
measurement; it does not promote any package or phase by itself.

## Alternatives Considered

### Keep marker-only phase checks

Rejected. Marker presence can be satisfied without the behavior, persistence, authorization,
recovery, or operational proof required by the phase.

### Delete or relabel earlier experiment results

Rejected. Autoresearch history is append-only evidence. Earlier results remain useful as records of
bounded kernels, but they must not be presented as full phase completion.

### Make the benchmark count only passing full-suite tests

Rejected. Full-suite health is necessary but cannot prove deployment rehearsals, external provider
behavior, release governance, or ownership decisions by itself.

## Consequences

### Positive

- The primary metric reflects actual roadmap exit evidence rather than implementation markers.
- Partial foundations remain visible without being mistaken for production readiness.
- Dependency order and global completion are mechanically enforced.
- Future autoresearch iterations have a clear next gate: durable Process checkpoint/release proof
  or explicitly evidenced operational work.

### Negative

- The corrected score may be lower than the earlier marker-based score.
- Some gates require real staging or operator evidence that cannot be produced by local code alone.
- The registry requires maintenance when an accepted roadmap gate changes.

### Risks

- A focused test can still be too narrow for a phase unless its gate definition names the required
  behavior and evidence boundary.
- Operational evidence may become stale; readiness manifests must retain review dates and accepted
  evidence classes.

## Validation

The roadmap-completion benchmark is valid when:

- every registry entry names a canonical source and stable gate identity;
- implementation gates require executable checks in addition to evidence artifacts;
- financial operational gates use the existing fail-closed readiness manifest;
- Process Studio and integration gates preserve documented dependency order;
- the global gate is green only when all registered gates are green;
- a repository validation run passes without changing the registry or score logic.

## Related Documents

- [`../roadmap/README.md`](../roadmap/README.md)
- [`../roadmap/process-studio.md`](../roadmap/process-studio.md)
- [`../roadmap/integration-surface.md`](../roadmap/integration-surface.md)
- [`../../.auto/prompt-roadmap-completion.md`](../../.auto/prompt-roadmap-completion.md)
