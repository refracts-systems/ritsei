# Financial Ledger Execution Roadmap

> **Status:** Canonical roadmap subdocument; production activation is **NO-GO**.
>
> **Track ID:** `financial`
>
> **Owns:** sequencing, dependencies, readiness gates, rehearsal, and cutover steps for the bounded
> TigerBeetle financial execution profile.
>
> **Measured by:** `financial.*` gates and `pnpm run financial:gate`.
>
> **Authority and runtime rules belong to:**
> [`../architecture/financial-ledger.md`](../architecture/financial-ledger.md),
> [`../decisions/0040-adopt-tigerbeetle-financial-ledger.md`](../decisions/0040-adopt-tigerbeetle-financial-ledger.md),
> and
> [`../decisions/0041-separate-deployment-profile-and-financial-authority.md`](../decisions/0041-separate-deployment-profile-and-financial-authority.md).
>
> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - P2 financial baseline:
>   [`../decisions/0036-define-p2-document-and-financial-baseline.md`](../decisions/0036-define-p2-document-and-financial-baseline.md)
> - State and consistency:
>   [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Durable execution:
>   [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)
> - Readiness evidence:
>   [`../operations/financial-readiness-evidence-2026-08-18.json`](../operations/financial-readiness-evidence-2026-08-18.json)

## Scope

Make TigerBeetle authoritative for accepted transfers, balances, and transfer history without
creating a dual-authority model or turning it into an ERP database. The first profile is
deliberately small:

```text
Legal Entity + fixed two-decimal base currency + open fiscal period
        ↓
account mapping → journal/revenue posting → reversal
```

Payments, settlement, credit limits, budgets, multi-currency, tax, AP/AR, valuation, and inventory
quantity remain separate decisions.

## Current position

| Area       | Current state                                                                               | Next proof                                             |
| ---------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Authority  | `FinancialLedgerPort` exists; PostgreSQL remains the executable entry profile               | no competing authority at activation                   |
| Intent     | deterministic mappings, durable intent, outcome, projection, and reconciliation state exist | complete PostgreSQL-before/after-engine fault matrix   |
| Adapter    | trusted provider-neutral kernel adapter and bounded local compatibility proof exist         | outage, quorum, restart, and exit rehearsal            |
| Reporting  | operation-level projection/rebuild exists                                                   | complete balance and report rebuild correspondence     |
| Cutover    | controlled prepare/approve/activate state machine exists                                    | signed bounded-cohort opening-balance/replay rehearsal |
| Production | **NO-GO**; live gate count is emitted by `pnpm run financial:gate`                        | close all P0 activation evidence                       |

The implementation slice is transitional. It does not authorize TigerBeetle production activation, a
live PostgreSQL mirror, or a per-request choice between authorities.

## Target boundary

| Owner                                     | Responsibility                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `modules/accounting`                      | policy, periods, authorization, public operation/finalize/reconcile commands                  |
| `platform/tigerbeetle`                    | TigerBeetle client lifecycle, deterministic IDs, batching, failure mapping, cleanup           |
| `runtime/worker` / `modules/process` jobs | leased submission and reconciliation work through public Accounting contracts                 |
| Accounting schema                         | intent, mapping, outcome, provenance, reconciliation, and projection metadata                 |
| PostgreSQL                                | control plane, historical archive, and rebuildable projection—not accepted-transfer authority |
| TigerBeetle                               | accepted transfers, balances, and immutable transfer history after cutover                    |

No TigerBeetle type or provider failure crosses the Accounting public contract. No Effect fiber is a
durability boundary.

## Sequence

### F0 — Authority and profile

**Status:** complete for the bounded decision. ADR-0040 selects TigerBeetle; ADR-0041 separates
financial authority from deployment profile; the current P2 scope remains bounded.

**Exit:** no document describes PostgreSQL and TigerBeetle as co-authorities, and the existing
cross-domain PostgreSQL transaction is not silently reinterpreted.

### F1 — Provider-neutral contract

Freeze the first-profile commands, port result/failure model, operation states, deterministic ID
encoding, accepted-event timing, unknown-outcome behavior, period races, authorization boundary, and
reconciliation anchor.

**Exit:** contract tests run without TigerBeetle; no provider types appear in public contracts; the
contract makes no cross-store ACID claim.

### F2 — Durable intent and projections

Persist only the control-plane records required by F1: idempotent operation intent, account/transfer
mapping, outcome and retry state, provider provenance, projection status, and manual-recovery
reason. Existing PostgreSQL journal history is not rewritten.

**Exit:** restart-safe retries, one logical operation per identity, recorded post-submission failure
path, and operation projection rebuild proof.

### F3 — Deterministic adapter proof

Use the test adapter to prove duplicate/conflicting replay, lost responses, process death, rejected
transfers, mapping/amount errors, linked transfers, reversals, reconciliation, quarantine, and
manual recovery. Keep scoped cleanup and `@effect/vitest` rules.

**Exit:** every retryable path has one identity and the full distributed failure matrix is covered;
PostgreSQL kill-point evidence remains a separate gate.

### F4 — Trusted TigerBeetle adapter

Pin the client only after F1–F3. Keep lifecycle, credentials, network, provider mapping, batching,
ordering, balance constraints, and provider-error translation in kernel/infrastructure.

**Exit:** isolated-engine compatibility, duplicate/timeout behavior, linked posting/reversal, and
no-domain-import proofs pass.

### F5 — Projection and reconciliation

Finalize PostgreSQL projections and outbox only after accepted engine outcome is known. Reconcile
accepted-but-unprojected operations, quarantine mismatches, and expose lag/retry/unknown/manual-
recovery measures. Corrections use authorized reversals; reconciliation never invents a transfer.

**Exit:** operation projections rebuild, reconciliation is idempotent and fail-closed, and
PostgreSQL is not a competing balance authority. Complete report/balance rebuild remains open.

### Staging decision hold (not registered)

Provider-neutral staging preparation remains inside this track, but its gates are intentionally not
registered while ADR-0064 and ADR-0065 are still Proposed. Before F6, accept, reject, or replace the
primary staging decision and record an explicit disposition for the optional edge/evidence plane.
Staging must not silently select custody, retention, topology, or a second authority.

### F6 — Replay and cutover rehearsal

For a bounded Legal Entity or tenant cohort:

1. freeze the profile and export verified PostgreSQL opening state;
2. replay approved history or verify opening balances in isolated TigerBeetle;
3. compare balances, transfer groups, reversals, and projections;
4. rehearse restore, outage, process restart, adapter exit, and in-flight operations;
5. sign the recovery watermark, deterministic-ID comparison, orphan quarantine, and owner approval.

**Exit:** signed historical/opening-balance evidence, executable restore/outage runbooks, and a
bounded cohort rehearsal.

### F7 — Scoped activation

Activate one explicit profile scope. All mutations for the selected invariant use TigerBeetle; there
is no PostgreSQL fallback or live mirror. Uncut scopes may remain on the transitional profile, but
one logical invariant is never routed to two authorities.

**Exit:** pilot SLOs, reconciliation lag, authorization, reporting, backup/restore, and forward-only
rollback evidence pass.

### F8 — Composite workflow migration

Revisit the Process/Accounting cross-domain workflow in a separate ADR. Either keep it on the
transitional PostgreSQL profile or redesign it as accepted/pending/reconciled work with explicit
compensation and recovery. Do not change this by swapping a Layer.

## Activation gates

One shared evaluator validates the sixteen production-evidence gates through `financial:gate`.
Activation is blocked while any required category is open:

```text
[ ] controlled activation and bounded cohort
[ ] process kill/restart and worker adapter restart
[ ] TigerBeetle outage, quorum, and fail-closed behavior
[ ] PostgreSQL is not financial authority after cutover
[ ] backup/restore and recovery watermark
[ ] global reconciliation and complete projection rebuild
[ ] artifact integrity and signing custody
[ ] key rotation and operator alerts
[ ] no unresolved P0 readiness item
```

Moving an affected cross-domain workflow to TigerBeetle remains a separate F8 consistency decision;
it is not silently represented as one of the sixteen evidence-manifest gates.

Current evidence is recorded in
[`financial-readiness-evidence-2026-08-18.json`](../operations/financial-readiness-evidence-2026-08-18.json)
and evaluated by `deno task financial:gate`. The current release decision remains **NO-GO**: local
adapter compatibility is not production recovery, quorum, restore, replay, or cutover proof.

## Measures

| Measure                                | Target before activation                     |
| -------------------------------------- | -------------------------------------------- |
| `financial_activation_gates_remaining` | `0`                                          |
| staging primary decision               | accepted before F6                         |
| accepted duplicate transfers           | `0`                                          |
| unresolved operation identities        | `0`                                          |
| restore/replay/cutover rehearsals      | signed and executable for the bounded cohort |
| report and balance rebuild difference  | `0`                                          |
| silent PostgreSQL fallback             | `0`                                          |

## Stop conditions

Stop activation when any P0 evidence is missing, the staging authority is not explicitly decided,
a proposed edge/evidence provider is treated as mandatory without disposition, a store can be
restored independently without fencing, an unknown outcome has no deterministic recovery path,
projections cannot be rebuilt, or any route can select PostgreSQL/TigerBeetle per request. Do not add a
generic TigerBeetle API, warehouse, payment model, or second ledger authority from this roadmap.
