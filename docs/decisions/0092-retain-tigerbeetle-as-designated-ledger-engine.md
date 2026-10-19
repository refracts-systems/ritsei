# ADR-0092: Retain TigerBeetle as the Designated Future Ledger Engine

- Status: Accepted
- Date: 2026-10-19
- Amends: ADR-0091 (TigerBeetle is retained as the designated future engine instead of being removed
  without a successor; PostgreSQL remains the only active financial authority)
- Compatible with: ADR-0003, ADR-0015, ADR-0042, ADR-0051
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Framework and flagship ERP decision:
>   [`./0091-adopt-framework-and-flagship-erp.md`](./0091-adopt-framework-and-flagship-erp.md)
> - Earlier TigerBeetle decision (superseded):
>   [`./0040-adopt-tigerbeetle-financial-ledger.md`](./0040-adopt-tigerbeetle-financial-ledger.md)
> - Financial ledger architecture: [`../architecture/financial-ledger.md`](../architecture/financial-ledger.md)
> - Exact amount boundary: [`./0042-exact-financial-amount-boundary.md`](./0042-exact-financial-amount-boundary.md)

## Context

ADR-0091 superseded ADR-0040, removed the TigerBeetle adapter from the tree, and made PostgreSQL the
only financial authority. It also expected Accounting types that still name TigerBeetle to be
simplified during the ledger redesign, which would erase the engine-switching design behind
`FinancialLedgerPort`: deterministic transfer identity, the durable intent-to-outcome protocol,
unknown-outcome handling, and reconciliation.

The owner wants TigerBeetle to remain RITSEI's long-term ledger engine and is following its
development, including hosting options that could make it cheap to run alongside RITSEI, such as
managed or edge-platform offerings. Re-deriving the engine-neutral protocol later would cost more
than keeping it now, and nothing in ADR-0091's ERP sequence requires deleting it.

## Decision

1. **PostgreSQL stays the only active financial authority.** Every Legal Entity posts through the
   PostgreSQL implementation of `FinancialLedgerPort`. No Legal Entity is routed to TigerBeetle, and
   two simultaneous authorities are never allowed. This part of ADR-0091 is unchanged.
2. **TigerBeetle is the designated future execution engine** behind `FinancialLedgerPort`, as the
   target that ADR-0040 selected, without ADR-0040's activation program as a current delivery
   track.
3. **The TigerBeetle path is kept, not deleted.** The remaining TigerBeetle-related Accounting code,
   schema, and tests, and the TigerBeetle sections of
   [`financial-ledger.md`](../architecture/financial-ledger.md), stay as the target design. The
   PostgreSQL ledger and numbering redesign may refactor them, but must keep the port
   engine-neutral and capability-aware, keep deterministic operation identity and outcome states,
   and must not remove the TigerBeetle path without a superseding ADR.
4. **The adapter may return as an inactive implementation.** A TigerBeetle adapter may be
   reintroduced behind the trusted platform boundary and tested against the port before a named
   user exists, provided no Legal Entity is routed to it. This narrows ADR-0091's "exactly one used
   implementation" rule for the ledger port only.
5. **Activation needs its own ADR.** Routing any Legal Entity to TigerBeetle requires a new ADR that
   names the user or workload, the hosting profile, and the cutover, recovery, and reconciliation
   evidence required by `financial-ledger.md`.
6. **No delivery track.** The financial-execution roadmap track is dormant: it does not gate
   framework or ERP phases.

## Alternatives Considered

- **Remove TigerBeetle entirely, as ADR-0091 implied:** rejected; it discards the engine-switching
  design the owner wants to keep, and reintroducing it later would mean redesigning the port.
- **Activate TigerBeetle now:** rejected; there is no user or load that needs it, and it would add
  an operational dependency before the ERP loops run.
- **Run PostgreSQL and TigerBeetle as dual authorities:** rejected permanently; one fact has one
  authority.

## Consequences

### Positive

- The ledger port stays ready for a second engine; hosted TigerBeetle offerings can be evaluated
  without a redesign.
- The financial-ledger architecture keeps its target design instead of being rewritten from scratch.

### Negative

- Accounting keeps code, tables, and tests for a path no tenant uses, which costs maintenance during
  the ledger redesign.
- Documentation carries inactive sections, which must stay clearly labeled.

### Risks

- Inactive code can rot. Containment: its tests keep running in the normal suite, and the ledger
  redesign keeps its port contract tests engine-neutral.
- The inactive path can be mistaken for an active one. Containment: no Legal Entity may be routed to
  TigerBeetle without an activation ADR, and `financial-ledger.md` states the current authority at
  the top.

## Validation

- The PostgreSQL ledger passes the port's contract tests without TigerBeetle types leaking into
  domain contracts.
- `financial-ledger.md`, the architecture specification, and the roadmap index state that
  PostgreSQL is the active authority and TigerBeetle the designated future engine.
- Any later activation proposal cites this ADR and supplies the evidence listed in decision 5.

## Related Documents

- [`../architecture/financial-ledger.md`](../architecture/financial-ledger.md)
- [`../proposals/framework-reset.md`](../proposals/framework-reset.md)
- [`../roadmap/README.md`](../roadmap/README.md)
