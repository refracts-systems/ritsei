# ADR-0063: Define Governed AI Recommendation and Agent Boundary

- Status: Accepted
- Date: 2026-08-30
- Amends: None
- Compatible with: ADR-0018, ADR-0020, and ADR-0043
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Global architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Process Studio: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Authorization: [`../architecture/authorization.md`](../architecture/authorization.md)
> - External integration surface: [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
> - Architecture enforcement: [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)
> - Process Studio roadmap: [`../roadmap/process-studio.md`](../roadmap/process-studio.md)

## Context

RITSEI needs room for intent interpretation, analytical recommendations, process-modeling
assistance, and future decision support. An unconstrained model or agent boundary would be able to
look like a new semantic owner, use stale analytical state as current truth, bypass authorization
and Separation of Duties, or mutate business facts through private repositories and provider tools.

The existing architecture already separates federated domain semantics, typed public capabilities,
versioned Process IR, deterministic runtime execution, authoritative facts/events, and derived
projections. AI must fit inside those boundaries rather than create a second authority model.

## Decision

RITSEI adopts a governed AI recommendation boundary. The binding principle is:

> AI may interpret intent, but only authorized domain commands executed by versioned deterministic
> processes may change business facts.

This decision defines a boundary and does not activate an AI provider, an AI package, an agent
runtime, a recommendation schema, or autonomous actuation.

### Ownership

- Owning domains retain business semantics, invariants, current-state validation, authorization
  policy, transactions, authoritative facts, and correction history.
- The Analytic Plane may expose authorized, freshness-qualified observations and evidence-bound
  recommendations. It does not become a business or authorization authority.
- Process Studio and the Process Runtime may carry typed drafts, recommendations, and execution
  provenance. They do not own domain facts or grant capabilities.
- Provider and model adapters remain behind the integrations boundary. They own transport,
  credentials, provider failures, retention configuration, and normalization only.
- No global Business Semantic Layer or `packages/ai` is introduced by this decision.

### Allowed AI roles

AI may:

- interpret a user request into a bounded, typed intent draft;
- summarize or classify owner-approved facts and analytic observations;
- produce an evidence-bound recommendation with explicit uncertainty;
- propose a draft Process IR or typed capability mapping for human review;
- suggest a typed domain action without invoking it.

Model output is untrusted input. It must pass Effect Schema decoding, tenant and scope checks,
allowlisted capability and version checks, and the owning validation path before it can become a
stored draft or recommendation.

An AI-generated process remains `DRAFT`. Normal static validation, review, release, deployment,
and version-pinning rules still apply. AI output cannot publish a definition, change a released
Process IR, register a capability, or select a dynamic action at runtime.

### Hard boundaries

AI and provider code must not:

- import domain tables, repositories, migrations, private services, or database clients;
- write business facts, authorization state, process definitions, policies, or financial state;
- grant, widen, or infer a capability, tenant, delegation, or scope;
- act as an `AgentPrincipal`, approver, reviewer, or Separation-of-Duties exception;
- treat confidence, freshness, a projection row, or a recommendation as proof of current state;
- execute arbitrary SQL, scripts, HTTP tools, or unrestricted agent loops;
- place prompts, provider topology, credentials, embeddings, or nondeterministic model calls in
  released Process IR.

The model or provider is not a RITSEI principal. If an adapter needs authorization to read approved
context or create a draft, it uses an explicitly scoped service identity with least privilege. The
originating human, reviewer, delegation, execution principal, tenant, scope, correlation, and
causation remain explicit and are never replaced by model output.

### Review and execution

Human or policy review is the default for recommendations. A recommendation is not an approval and
an approval is not an execution lease. Observation, review, queueing, and dispatch independently
revalidate current visibility, capability, object relationship, domain policy, Separation of Duties,
expiry/actionability, and admission.

A proposed action binds the exact recommendation and evidence version, typed action and catalog
version, canonical validated input, and owner-visible idempotency identity. Execution re-enters the
owning public domain command; retries reuse the same bound intent and unknown outcomes use the
owner's status or reconciliation contract. The model is never called again to silently change a
retry's meaning.

No AI or autonomous-agent node is part of the 1.0 Process IR. Closing an automatic action loop
requires a later accepted ADR with an allowlist of bounded actions, explicit risk ownership,
current authorization and SoD checks, idempotency and reconciliation proof, redaction and provider
controls, rollback/compensation policy, and failure-injection evidence.

### Data and evidence

AI context is tenant-scoped, minimized, purpose-bound, and sourced only from public contracts or
approved analytic observations. Recommendation records preserve model/evaluator and policy
versions, source fact and metric versions, query scope, authorization scope, `dataAsOf`, completeness
frontier, confidence semantics, expiry, and immutable citation bindings. Provider credentials,
private rows, raw errors, and transport details remain outside public contracts and user-visible
recommendation history.

The detailed evidence, freshness, actionability, disclosure, and reconciliation rules remain owned
by the Analytics and Authorization architectures.

## Alternatives Considered

### AI as a domain or semantic authority

Rejected. It would create a competing meaning for sales, inventory, accounting, authorization, and
other owner-controlled facts.

### Agent as a Process IR node

Rejected. A live model call is nondeterministic, difficult to replay, and too powerful for the
1.0 deterministic runtime. Typed proposals may enter the normal draft and review pipeline instead.

### Agent as an authorization principal

Rejected. Existing human, service, process, and delegated principals already express provenance.
An implicit agent principal would make capability and SoD enforcement ambiguous.

### Automatic approval and mutation by default

Rejected. Recommendation, approval, and execution have different authority, timing, and recovery
semantics. Automatic action requires a separate decision and evidence.

### New central AI or semantic package

Rejected. There is no invariant owner or measured need for a new cross-domain authority. Adapters,
analytics, process orchestration, and owner domains keep their existing responsibilities.

## Consequences

### Positive

- AI assistance can be added without moving business authority out of owning domains.
- Draft modeling and recommendations remain compatible with typed contracts and deterministic
  Process IR.
- Evidence, authorization, SoD, idempotency, and unknown-outcome rules remain explicit.
- Provider replacement does not leak model or transport types into domain contracts.
- Autonomous actuation is a deliberate, reviewable future decision rather than an accidental feature.

### Negative

- AI assistance requires schema, provenance, redaction, and review metadata.
- Recommendations may be stale, uncertain, rejected, or unavailable by design.
- Human review and owner reauthorization add latency to proposed actions.
- Provider adapters need separate operational and data-handling controls.

### Risks

- Prompt injection or retrieved content may influence an unsafe proposal.
- Model drift may change recommendations without an explicit version change.
- Provider retention, residency, or training behavior may disclose protected context.
- Teams may mistake confidence or a successful model response for authorization or current truth.
- A future agent loop may reintroduce duplicate effects or hidden cross-domain mutation unless its
  activation gates remain separate.

## Validation

Before any AI-backed feature is activated, prove:

- provider SDK imports are confined to approved integration adapters;
- AI/provider code cannot import tables, repositories, migrations, private services, or database
  clients, and its runtime identity has no direct business-fact write privilege;
- model output is decoded into a versioned typed contract and rejects unknown fields, invalid
  capability references, cross-tenant scope, and unbounded tool requests;
- Process IR contains only typed catalog references, pure decisions, and deterministic data—not
  prompts, provider topology, dynamic actions, or live model calls;
- recommendations bind immutable evidence, provenance, freshness, confidence, expiry, and current
  authorization scope;
- review, dispatch, retry, cancellation, compensation, unknown outcomes, and reconciliation bind
  the same recommendation/action/input identity and fail closed on changed intent;
- AI cannot satisfy approval or Separation-of-Duties requirements and every action reaches the
  owning public command;
- tenant isolation, redaction, retention, provider failure, prompt-injection, and disclosure tests
  pass; and
- autonomous actuation is not enabled without a later accepted ADR and its own bounded safety
  evidence.

## Related Documents

- [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
- [`../architecture/process-studio.md`](../architecture/process-studio.md)
- [`../architecture/authorization.md`](../architecture/authorization.md)
- [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)
