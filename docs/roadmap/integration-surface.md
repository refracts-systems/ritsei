# External Integration Surface Roadmap

> **Status:** Canonical roadmap subdocument
>
> **Track ID:** `integration`
>
> **Owns:** sequencing and readiness gates for the connector and external action/event surface.
>
> **Measured by:** `integration.*` exit evidence (reviewed; the mechanical evaluator was retired by ADR-0089).
>
> **Detailed semantics belong to:**
> [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md).
>
> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - Domain maturity: [`./domain-maturity.md`](./domain-maturity.md)
> - Integration architecture:
>   [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
> - Process Studio: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Plugin architecture:
>   [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)
> - Integration profile ADR:
>   [`../decisions/0019-adopt-integration-surface-profile.md`](../decisions/0019-adopt-integration-surface-profile.md)

## Scope

External integration is a typed, versioned, observable boundary—not a shortcut around domain
ownership and not transport metadata in Process IR. Numeric milestone labels are historical roadmap
identifiers, not product SemVer.

```text
external protocol → connector adapter → ExternalAction / ExternalEvent
                  → public domain contract or Process Studio
```

## Sequence

### 0.8 — Contract profile (`integration.contract08`)

Use the approved baseline:

```text
HTTPS + JSON + OpenAPI 3.2.0
CloudEvents 1.0.x over HTTPS/Webhook
AsyncAPI 3.1.0 catalog
OAuth 2.0 with RFC 9700 security practices
RFC 9457 Problem Details
```

**Exit:** Domain/External actions and events are distinct; IDs, versions, schemas, scopes, and
tenant boundaries are typed; OpenAPI operations are allowlisted; CloudEvents envelopes and payloads
are separately validated; credentials do not enter Process IR or domain contracts.

### 0.85 — Connector runtime (`integration.runtime085`)

Implement the minimum headless path: OpenAPI action invocation, HTTPS webhook ingestion, CloudEvents
validation, OAuth scope enforcement, idempotency/deduplication, timeout/bounded retry, and delivery
log.

**Exit:** duplicate provider requests/events are safe; timeout and unknown outcome are observable;
errors normalize to stable integration failures; network calls do not extend PostgreSQL
transactions; side effects have compensation or manual recovery.

### 0.9 — Reliability and compatibility (`integration.reliability09`)

Add dead-letter handling, replay protection, rate/payload limits, redaction/retention, provider
status, contract compatibility, health, and lag measures. gRPC, Kafka, AMQP, NATS, SQS/Pub/Sub,
EventBridge, SOAP, and OData remain optional adapters behind the same boundary.

**Exit:** advanced protocols are invisible to Process IR; every adapter has an owner, version,
compatibility range, tests, provider-specific retry policy, and secret-handling review.

### 0.95 — Process Studio integration (`integration.process095`)

Expose only approved connector capabilities through catalog references. The canvas sees typed
inputs/outputs, scope, idempotency, timeout, retry, and compensation—not transport details.

**Exit:** external actions/events are versioned and catalog-driven; OAuth scopes remain separate
from domain capabilities; static validation and side-effect-free simulation pass.

### 1.0 — Governed integration surface (`integration.governed10`)

Deliver connector registration/review, OpenAPI import governance, webhook verification, publication,
versioning/retirement, operator delivery controls, provider runbooks, audit, and redaction.

**Exit:** no unreviewed operation is executable; connector and domain lifecycles are separate;
published processes remain compatible; external effects support retry, compensation, or manual
recovery; approved contracts can generate public documentation.

## Current evidence

The bounded provider-neutral proof covers tenant-scoped replay protection, normalized status,
retry/dead-letter outcomes, redaction, compatibility/payload checks, health/lag metrics, and the
Process Studio bridge. It does not activate a provider or claim production readiness.

## Provider activation (not registered)

The governed surface is provider-neutral. Do not add a provider gate until one provider has a named
owner and a committed deployment profile. The selected provider gate must require its compatibility
range, credentials boundary, production endpoint, outage and unknown-outcome rehearsal, duplicate
effect proof, secret rotation, redaction, and reviewed runbook. A provider gate is downstream of
`integration.governed10`; it never becomes a universal dependency merely because the integration
surface is complete.

## Measures

| Measure                                                   | Target for governed-surface proof |
| --------------------------------------------------------- | --------------------------------- |
| `integration.*` mechanical gates                          | all five pass                     |
| unreviewed executable connector operations                | `0`                               |
| duplicate side effects after retry                        | `0`                               |
| external operations without idempotency/recovery metadata | `0`                               |
| credentials or raw provider payloads in Process IR        | `0`                               |
| provider-specific transport types in domain packages      | `0`                               |

`integration_surface_gates_remaining` is the live roadmap metric. The other rows are provider or
release-evidence requirements, not separately emitted counters. A passing surface gate does not
activate a provider. Provider activation additionally requires a selected owner, credentials,
production endpoint, recovery rehearsal, and reviewed runbook.

## Stop conditions

Stop exposure when a provider operation lacks idempotency or unknown-outcome handling, OAuth scope
is used as domain authorization, arbitrary script/SQL/unrestricted HTTP is required, retry semantics
are undocumented, credentials enter Process IR, no adapter owner exists, provider activation lacks
an explicit profile and runbook, or compensation/manual recovery is undefined.
