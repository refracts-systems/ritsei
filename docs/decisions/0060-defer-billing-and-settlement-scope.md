# ADR-0060: Defer Billing and Settlement Scope Until Ownership Is Ready

- Status: Superseded
- Date: 2026-08-27
- Amends: None
- Compatible with: ADR-0018, ADR-0019, ADR-0020, ADR-0036, ADR-0040, ADR-0041
- Supersedes: None
- Superseded by: ADR-0091 (product reset)

> **Related documents**
>
> - Domain maturity roadmap: [`../roadmap/domain-maturity.md`](../roadmap/domain-maturity.md)
> - Process Studio roadmap: [`../roadmap/process-studio.md`](../roadmap/process-studio.md)
> - ERP primitive roadmap: [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)
> - Financial ledger architecture: [`../architecture/financial-ledger.md`](../architecture/financial-ledger.md)

## Context

The current repository has bounded revenue recognition and financial-ledger execution semantics,
but it does not have an accepted owner and lifecycle for invoices, receivables, payables, payments,
settlement, tax, credit policy, or cross-domain correction of those facts. Treating `billing` as a
Process Studio provider now would require guessing business authority and would blur the boundary
between Accounting's current revenue profile and future obligation/settlement facts.

The roadmap requires purchase and payment workflows to have explicit ownership before Process Studio
can depend on them. An explicit scope decision is therefore needed so the absence of Billing is a
controlled gate rather than an implicit assumption.

## Decision

For the current committed roadmap and Process Studio release gates:

1. `billing` remains `NOT READY` and is not a Process Studio provider.
2. Accounting owns the current bounded revenue-posting and financial-ledger profile only. This does
   not make Accounting the owner of invoices, receivables, payables, payments, settlement, tax, or
   credit policy.
3. Procurement owns purchase orders and goods receipts. A purchase-to-pay process must not invoke
   invoice, payable, payment, or settlement behavior until a later ownership decision exists.
4. Process Studio may proceed with bounded non-billing capabilities. It must reject or keep out of
   released definitions any capability that requires the undecided Billing surface.
5. A future Billing decision must define one semantic owner per invariant, public contracts,
   authorization, transaction and financial authority, idempotency, correction/reversal,
   integration, audit, recovery, and catalog compatibility before implementation.

This is an explicit deferral and scope boundary, not an implementation claim or a readiness claim for
Billing.

## Alternatives Considered

### Make Accounting own billing by default

Rejected. The current Accounting profile owns revenue posting and ledger execution, not invoice,
obligation, payment, or settlement lifecycles. Extending that authority without a contract would
create an irreversible ownership ambiguity.

### Implement a minimal Billing package immediately

Rejected. A package scaffold would not decide invoice/payment/settlement semantics and would make a
roadmap directory look mature without executable ownership or invariant proof.

### Leave the roadmap undecided

Rejected. An unresolved decision would block dependent Process Studio gates without explaining the
safe boundary. This ADR makes the block explicit and records the re-entry conditions.

## Consequences

### Positive

- Process Studio has an explicit, fail-closed boundary around financial workflows.
- Accounting's current revenue authority is not silently expanded.
- Procurement's purchase-order and goods-receipt ownership remains clear.
- Future Billing work has concrete entry criteria instead of inferred ERP behavior.

### Negative

- Invoice, payment, settlement, tax, receivable, payable, and credit workflows remain unavailable.
- The roadmap still reports Billing as `NOT READY` until the future decision and implementation pass.

### Risks

- A future product request may be incorrectly routed to Accounting unless this ADR is checked.
- External payment integrations may appear to imply Billing ownership; connector capability does not
  establish domain authority.

## Validation

This decision is valid while:

- no Billing action or event is registered as a Process Studio provider;
- current Accounting public contracts remain limited to their documented bounded profile;
- Process Studio release validation rejects capabilities requiring undecided Billing semantics;
- a future Billing ADR supplies the owner and re-entry evidence before implementation.

## Related Documents

- [`../roadmap/domain-maturity.md`](../roadmap/domain-maturity.md)
- [`../roadmap/process-studio.md`](../roadmap/process-studio.md)
- [`../roadmap/erp-primitives.md`](../roadmap/erp-primitives.md)
- [`../decisions/0019-adopt-integration-surface-profile.md`](./0019-adopt-integration-surface-profile.md)
