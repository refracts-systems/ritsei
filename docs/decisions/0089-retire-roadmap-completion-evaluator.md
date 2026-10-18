# ADR-0089: Retire the Roadmap Completion Evaluator

- Status: Accepted
- Date: 2026-10-19
- Amends: None
- Compatible with: ADR-0061 (executable evidence principle)
- Supersedes: ADR-0061's mechanical aggregator (`roadmap:measure`) only
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Repository rules: [`../../AGENTS.md`](../../AGENTS.md)
> - Roadmap index: [`../roadmap/README.md`](../roadmap/README.md)
> - ADR-0061: [`./0061-correct-roadmap-gate-granularity.md`](./0061-correct-roadmap-gate-granularity.md)

## Context

ADR-0061 required executable evidence for roadmap gate completion and was implemented as
`tooling/roadmap-completion/` (a hand-maintained gate registry and aggregator, about 1,800 lines) plus
`tooling/domain-maturity/`, run by `pnpm run roadmap:measure` in CI and `release:check`.

The aggregator mostly re-ran checks CI already runs (`check`, `test`, `boundary:lint`) and matched
marker strings in source and docs. Every roadmap change required registry maintenance, it drew agent
effort toward raising a score rather than the requested outcome, and it contradicted the repository
rule against adding evaluators and CI gates that existing checks can already cover.

## Decision

1. Remove `tooling/roadmap-completion/`, `tooling/domain-maturity/`, the `roadmap:measure` script, its
   CI step, and its `release:check` entry, together with their dedicated tests.
2. Keep ADR-0061's principle: a gate is complete only with executable evidence. Executable evidence
   is the repository's existing tests and checks (`check`, `test`, `boundary:lint`, `db:check`,
   `fallow:audit`, `financial:gate`, PostgreSQL 19 rehearsal), plus reviewed operational evidence.
3. Keep `tooling/financial-gate.ts` and `pnpm run financial:gate`; the sixteen financial
   production-evidence gates and the NO-GO decision are unchanged.
4. Roadmap gate IDs remain stable labels. Roadmap documents no longer claim live counters; any
   snapshot is a reviewed statement.

## Alternatives Considered

- Keep the aggregator but drop it from CI: rejected because an unrun registry rots and still
  encourages score-chasing.
- Rewrite it smaller: rejected because the existing checks already prove the same facts.

## Consequences

- Release readiness is judged from CI results and reviewed operational evidence, not one score.
- Roadmap status is not mechanically verified; a reviewer must keep prose consistent with tests.
- Less tooling to maintain and a smaller Fallow baseline.
