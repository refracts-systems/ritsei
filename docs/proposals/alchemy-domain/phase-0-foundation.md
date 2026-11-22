# Phase 0: Foundation

> **Status:** Awaiting review
>
> **Roadmap gate:** `alchemy.foundation`
>
> **Related documents**
>
> - Phase index: [`./README.md`](./README.md)
> - Roadmap track: [`../../roadmap/alchemy-domain.md`](../../roadmap/alchemy-domain.md#foundation-alchemyfoundation)
> - Decision: [`../../decisions/0124-adopt-alchemy-domain-in-phases.md`](../../decisions/0124-adopt-alchemy-domain-in-phases.md)

## Scope

Make Alchemy Domain run inside RITSEI on its real host, with no rule changed and no aggregate moved.
Every later phase depends on what this phase proves or refutes.

## Prerequisites

- ADR-0124 accepted.
- A PostgreSQL 19 database reachable from tests.

## Deliverables

1. **Effect upgrade.** `effect` and every `@effect/*` package (`@effect/platform-node`,
   `@effect/platform-node-shared`, `@effect/sql-pg`, `@effect/vitest`) move from `4.0.0` to the
   4.1 line in their own change. `vendor/effect` is refreshed to the same version, because
   `AGENTS.md` makes it the reference for Effect code.
2. **Dependencies.** `@alchemy.run/domain`, `@alchemy.run/effect-cluster`, and `alchemy` pinned
   exactly in the root `package.json`, with the reason recorded beside them. `alchemy` is a
   required peer; `foldkit` is an optional peer (`peerDependenciesMeta`) and is not installed.
3. **Framework port.** An engine-neutral port in `framework/` that hides the host, with the
   in-memory host for tests and the Effect Cluster host for runtime. It lands together with its
   first ERP consumer (phase 1), per ADR-0091; until then it lives on the phase branch.
4. **Host table under migration control.** The host creates `alchemy_domain_objects` with
   `CREATE TABLE IF NOT EXISTS` at runtime. A reviewed migration creates it instead, an entry in
   `db/ownership.toml` names its owner, and the host's role can create tables only in a schema
   that holds host tables (the host's `CREATE TABLE IF NOT EXISTS` needs `CREATE` even when the
   table exists).
5. **Event protection.** The host's storage API updates and deletes keys. Whether recorded events
   are ever rewritten was not verified; this phase finds out and, if events and state share the
   table, protects event rows from update and deletion with privileges or a trigger.
6. **Pilot on the real host.** The nine `SAL-DLV-2` pilot stories run on Effect Cluster against
   PostgreSQL 19. The pilot lives outside the repository today; it is copied in as tests.
7. **History measurements.** An event recorded before a schema change decodes after it, and rebuild
   time per tenant is measured on a realistic volume.
8. **Database-enforced rules inventory.** A list of every rule PostgreSQL enforces today with a
   constraint, trigger, or privilege, and where each check moves when its aggregate leaves the
   tables.
9. **Runner pool.** `layerEntities` takes a `pool` layer deployed through Alchemy's infrastructure as
   code (the documented example is a Docker Swarm pool with its database) and requires Alchemy
   providers. The phase deploys a pool for tests and records how much of Alchemy's deployment
   tooling the host needs, and whether RITSEI's deployment profiles can carry it.

## Exit evidence

The deliverables above, and the full validation list in `AGENTS.md` passing after the upgrade.

## Exit evidence (recorded)

Recorded by an agent run on 2026-11-22; the owner has not reviewed it and the phase is not accepted.
Numbers come from one machine: WSL2 (Ubuntu 26.04) with 4 CPUs, 8 GB RAM and an ext4 virtual disk,
Docker 29.1.3 with a one-node Swarm, Node 24.22.0 run from a copy of the worktree on the WSL
filesystem. They show order of magnitude, not capacity.

### What ran

`framework/platform/domain-model/tests/pool/` deploys the pilot to a local Docker Swarm with the
Alchemy CLI and drives it over HTTP. It runs only with `RITSEI_ALCHEMY_POOL=1` and an active Swarm; the
normal suite skips it with that reason (checked on Windows, where it skips).

- **Database:** the `postgres:19` image, `PostgreSQL 19.0 (Debian 19.0-1.pgdg13+1)`, one replica on an
  overlay network. The repository's two `domain_model` migrations were applied to it before any
  runner started, and the login's `search_path` was set to `domain_model`.
- **Pool:** `ClusterDocker.SwarmPool` with one runner replica (`gatewayPort` published), plus a
  `Docker.Service` that serves the model's `Domain.Api` and calls the gateway. The runner image
  is built by Alchemy from the model module (`FROM node:26-slim`); the Api image from `oven/bun:1`.
- **Model:** variant B of the pilot (`DeliverOrderIssueFirst`), from `delivery-model.ts`, with views added to
  read outcomes. Variant A and the in-memory `Story` runner were not run on the host.

### Scenarios (variant B, on the host, both N=100 and N=1,000 runs)

| Outcome | Result |
| --- | --- |
| A delivery completes and issues stock; a service line moves none | `Delivery` completed, stock 10 to 7 (value 1000 to 700), order shows L1:3, L2:1 delivered |
| Over-delivery refused | Delivery failed (`rejected`); stock issued then returned (3 events on the item), order has only its confirmation event |
| A failed second-line issue is compensated | First line's stock returned (3 events), second item untouched (1 event), delivery failed, order untouched |
| A retried request records nothing new | A resend with a new command id and with the first id left the event row count and the stock unchanged |

Views are eventually consistent, so the test waits until a view shows the expected state. Not
checked on the host: the ledger journal (`JournalForSource`). The projection's store in this test is
`MemoryLedgerStore`, per runner process, so it says nothing about a durable ledger.

### Runtime-created tables (deliverable 9, item b)

After the runner started, every table in the database outside the system catalogs was:

```text
domain_model.alchemy_domain_objects        (created by migration)
domain_model.cluster_locks
domain_model.cluster_messages
domain_model.cluster_migrations
domain_model.cluster_replies
domain_model.cluster_runner_migrations
domain_model.cluster_runners
```

The six `cluster_*` tables are created by Effect Cluster's SQL storage in the runner at startup,
through the same connection, so they land in whatever schema the login's `search_path` names:
`domain_model`. The list was the same after the second and third deploys. **Proposed owner:** the
domain model port, in the `domain_model` schema (the schema then holds host tables only, as the
decision above requires). They are versioned by Effect Cluster itself (`cluster_migrations`,
`cluster_runner_migrations`), so they are not RITSEI migrations; `db/ownership.toml` can name them,
and the host's login keeps `CREATE` on `domain_model` for them. Pinning them in reviewed migrations
would mean copying the library's DDL and following each release.

### Does the host rewrite an event key? (deliverable 4/5, item a)

No case was found. The PostgreSQL service log held zero lines of the trigger's refusal (`recorded
domain events cannot be changed or deleted`), checked after the scenarios, after the bulk load with a
forced runner restart in the middle (`docker service update --force`, sagas in flight; every
delivery still reached a terminal state), after the second deploy, and after the third. A refused
`ON CONFLICT DO UPDATE` would be a logged error, so none occurred. The test fails if the count is not
zero. Limits: one runner replica, a graceful restart only (no kill, no shard handover between
runners), and a login that is the database superuser, so `ritsei_domain_host`'s privileges were not
exercised.

### Event schema change and rebuild (deliverable 7)

- **Decoding.** Three `ProbeNoted` events were recorded with `{ text }`. The second model adds
  `tag: Schema.optional(Schema.String)` to the event and a view over it. After a new event with a
  `tag`, the view held `{ notes: 4, tagged: 1 }`, so the host decoded the three old events with the
  new class, and the test decodes the four stored rows with the second schema directly (old ones have
  no `tag`).
- **A view added after history exists is not rebuilt by itself.** With 1,000 deliveries recorded, a new
  warehouse-keyed view stayed empty (`null`) for the 120 seconds the test waited, and the backfill
  progress row read `phase: complete, instances: 0, subtrees: 0` even though the directory listed the
  24 stock items. A second, aggregate-keyed view behaved the same until its source received a new
  command, when it picked up the old events with it. Bumping the view's `version` (third deploy) did
  not rebuild it in 180 seconds either (10 minutes at N=100). The deploy-time rebuild that the
  package documents did not happen on this host in `2.0.0-beta.87`.
- **Rebuild by touching the sources.** Sending one more command to each of the 20 stock items
  rebuilt the warehouse view from the whole history: 1,000 issues folded into one tenant key in
  13.9 seconds including the 20 writes (N=1,000, one runner). Not measured at N=100 (the step was added after) or 10,000.

### Measurements

| N deliveries | Bulk time (runner restarted mid-run) | Event rows | Database | Runner memory (end) |
| --- | --- | --- | --- | --- |
| 100 | 62 s (1.6 per s) | 543 | 13 MB | 201 MiB |
| 1,000 | 138 s (7.3 per s) | 5,043 | 46 MB | 668 MiB |

Each delivery is two commands (confirm the order, request the delivery) plus the saga, about five
events. The run used 8 concurrent clients; a deploy of the model took 23 to 33 seconds. Peak memory
used in the VM during the 1,000 run was 3.4 GB (runner 668 MiB, PostgreSQL 452 MiB, Api 90 MiB at
the end of the bulk load). **Not run:** N=10,000 (the runner already used 668 MiB at 1,000, and the
disk and memory guards for this run said to skip it), a second runner replica, and variant A.

### What the host needs from Alchemy's deployment tooling (deliverable 9)

- **Packages:** `alchemy` (CLI and bundler), `@alchemy.run/effect-cluster`, `@alchemy.run/domain`, and
  `@alchemy.run/docker` for `ClusterDocker`, a new dev dependency here. The runner itself needs
  none of the CLI: it runs `node /app/runner.mjs`, a bundle that Alchemy builds from the model
  module and the entity runtime.
- **CLI:** the deploy ran as `tsx node_modules/alchemy/bin/alchemy.js deploy <stack> --stage pilot`.
  Plain `alchemy deploy` under Node 24 failed to import the model: the package's `alchemy/Runtime/Bootstrap`
  export points at TypeScript source, which Node refuses to load from `node_modules`. `vitest.config.ts`
  already inlines it for tests; the CLI needed `tsx` as its loader.
- **State:** `Alchemy.localState()` writes `.alchemy/` (state, bundles, logs, the generated random
  database password) under the working directory. It is gitignored here. A shared state store would be
  needed for more than one operator.
- **Docker:** a Swarm manager (overlay network, named volume, services) and image builds on that daemon.
  Base images come from a registry (`node:26-slim`, `oven/bun:1`, and the database image). Each deployed program is a
  new image tagged by its hash, 358 MB each for the runner, and old tags are not removed.
- **Findings from deploying it:**
  - `ClusterDocker.Database` mounts its volume at `/var/lib/postgresql/data`. The PostgreSQL 19 image
    refuses to start with a mount there (exit 1, restarted in a loop). `PGDATA` cannot be set through the resource.
    The test uses a copy of that layer with the mount at `/var/lib/postgresql`, built from its
    `@internal` `clusterShardGroups` export.
  - The Api service must join the cluster's overlay network by name, or it cannot resolve the
    gateway (`http://<pool-service>:34500`). The package's README example does not show this.
  - The database URL ClusterDocker builds uses the `postgres` superuser, so a host role without
    `CREATE` on anything but `domain_model` was not tried end to end.

**Can RITSEI's deployment profiles carry it?** Not as they stand. `deploy/entry/compose.yaml` is the only
executable profile (PostgreSQL 19, migrations, API, worker) and the deployment notes name no runner pool,
Swarm, or Alchemy state. The runtime part fits a Compose service: a container from the bundled runner image
and the environment `SwarmPool` sets (`CLUSTER_DATABASE_URL`, `CLUSTER_GATEWAY_TOKEN`, `CLUSTER_POOL`,
the shard group variables, and `CLUSTER_PEERS`, which here is Swarm's `tasks.<service>` DNS name). The build
part is the problem: the runner image is produced by Alchemy's bundler, so a release pipeline would depend
on `alchemy` and `tsx` at build time, and standard and larger profiles would need an equivalent of
Swarm's per-task DNS. None of this was exercised outside Swarm, and it needs an owner decision (and
a deployment-profile update) before a phase 1 consumer relies on it.

## Stop conditions

- The host does not run on PostgreSQL 19.
- Recorded events cannot be protected from update and deletion.
- A beta upgrade breaks the port with no migration path.

## Five views

This phase changes no rule, but the host's storage decides what later phases can keep. The views
below name the rules whose protection depends on PostgreSQL today.

- **Auditor.** Three rules rely on the database to keep records unchangeable: `ACC-OPEN-4` (journals
  are never deleted; a wrong one is corrected by a new, traceable entry), `INV-STOCK-2` (movements
  are never updated or deleted), and `SET-BANK-2` (a trigger forbids updating or deleting
  statements). Events take over that role for every aggregate that moves, so they need the same
  protection in the database, not by convention (deliverable 5).
- **Accountant.** No posting, period, or report changes. One rule to carry forward: `INV-VAL-1`
  keeps each valuation equal to its entries through a deferred database trigger; whatever replaces
  it in phase 4 must be as strict.
- **Systems engineering.** Several rules are enforced by PostgreSQL itself: `SAL-ORDER-1` (rejects
  changes to confirmed snapshots), `SAL-ORDER-3` (tenant-local composite constraints), `SAL-CUST-1`
  (rejects non-canonical and duplicate emails), `PRC-PO-1` (frozen confirmed order), `PRC-REL-1`
  (self-approval forbidden by the database), `TAX-PROD-1` (product tax defaults bound to codes of
  the same direction), and `BIL-RENDER-2` (artifact integrity). JSON state in
  `alchemy_domain_objects` has none of this, so deliverable 8 lists every such rule and where its
  check moves. The rest of the technical risk is the Effect upgrade, the beta dependency and its
  peers, a second connection pool, and a table created at runtime; backups and restores must include
  the host's table.
- **ERP engine development.** `SAL-AUTH-1`, `PRC-AUTH-1`, `INV-AUTH-1`, and `TAX-AUTH-1` deny by
  default per tenant, and `PRC-PO-4` makes a foreign-tenant record not found. The port decides
  where those checks run for stream-held aggregates; hiding the host behind it keeps a later engine
  change possible. Stories follow the repository's test rules: `@effect/vitest` imports and
  `assert` rather than `expect`. The event schema policy (optional fields only; a change of meaning
  is a new event) is written here once.
- **Warehouse operations.** Nothing changes for people handling stock; the stock rules
  (`INV-STOCK-*`, `INV-VAL-*`) stay on their tables.

## Open questions

Answers marked "decided in phase 0" are pending owner confirmation.

- Does the port expose Alchemy's model classes directly, or a RITSEI wrapper?

  **Decided in phase 0:** neither a wrapper nor the package. A module imports
  `framework/foundation/domain-model/mod.ts`, which re-exports exactly the declaration factories the
  pilot uses (`Aggregate`, `Command`, `Event`, `Model`, `Policy`, `Projection`, `Query`, `Rejection`,
  `Saga`, `verify`) and `Story`, the in-memory host. They are generic class factories whose types are
  the model shape, so a wrapper would repeat them without hiding anything. What the port hides is the
  host: the Effect Cluster host is `framework/platform/domain-model/mod.ts`, and a module never
  imports `@alchemy.run/domain`. The cluster adapter takes the runner pool as a parameter, so no
  deployment package is imported. The event schema policy is in the port's module docs: a change adds
  optional fields only; a change of meaning is a new event.

- Where do tenant scope and authorization run: Alchemy middleware, `decide`, or the port?

  **Decided in phase 0:** in the RITSEI service, before it sends a command, as the services do today,
  so the deny-by-default capability checks keep their tests and their audit. The service builds the
  aggregate instance id from the caller's tenant, so a foreign tenant's instance is not addressable
  and reads as not found (`PRC-PO-4`). `decide` sees only data in the command and the aggregate's own
  state. Open for phase 1: a saga or policy acts without a caller, so the authorized command's tenant
  and principal must travel in the saga input, and every saga step needs a story that a foreign
  tenant's command is refused.

- Which database role owns the host's table, and which roles may read it?

  **Decided in phase 0:** a reviewed migration creates `domain_model.alchemy_domain_objects`; the
  migrator owns it, and the schema is registered in `db/ownership.toml` against the port. A login
  `ritsei_domain_host` (`CLUSTER_DATABASE_URL`) has `USAGE` and `CREATE` on the schema, DML on the
  table, and `search_path = domain_model`; no other role reads it. The host's table creation was
  tested on PostgreSQL 19: `CREATE TABLE IF NOT EXISTS` is refused for a role without `CREATE` on the
  schema even when the table exists, so deliverable 4's "the runtime role cannot create tables" cannot
  hold with the host as shipped. The schema holds host tables only, so the grant reaches nothing
  else. Effect Cluster's own SQL storage (message, reply, and runner tables, created at runtime by the
  runner pool and gateway) is a second set of runtime-created tables that this phase has not put under
  migration. A trigger refuses `UPDATE`, `DELETE`, and `TRUNCATE` of `event:` keys only: the host
  writes those once and rewrites other keys (state, receipts, outbox, backfill) all the time. Receipt
  rows carry a copy of their events and are not protected.

## Findings that correct ADR-0124

ADR-0124 is accepted and is not rewritten (ADR-0123); these phase 0 findings correct it:

- **`foldkit` is an optional peer**, not a required one (`peerDependenciesMeta` of
  `@alchemy.run/domain` 2.0.0-beta.87). It is not installed.
- **The host's role needs `CREATE`.** PostgreSQL 19 refuses `CREATE TABLE IF NOT EXISTS` without
  `CREATE` on the schema even when the table exists, and the host runs it at startup. The table
  lives in a schema that holds host tables only (`domain_model`), and the host's role may create
  there; its login must resolve to that schema through `search_path`, or it creates an unprotected
  table in `public`.
- **The host uses more than one table.** Besides `alchemy_domain_objects`, the runner pool and
  gateway run Effect Cluster with SQL storage, which creates message, reply, and runner tables at
  runtime. The Swarm run found six `cluster_*` tables, listed with a proposed owner in the recorded exit
  evidence.
- **Recorded events are never rewritten.** The host writes an aggregate's events once under
  `event:<sequence>` keys; state, receipts, outbox, backfill, and view rows are rewritten or
  deleted. A trigger refuses `UPDATE`, `DELETE`, and `TRUNCATE` of `event:` keys, so the stop
  condition "events cannot be protected" does not apply.
- **Vitest inlines Alchemy packages.** `alchemy` publishes TypeScript sources as Node entry points,
  so `vitest.config.ts` inlines `alchemy` and `@alchemy.run/*` for tests that load the host adapter.

## Review record

| Date | Reviewer | Outcome | Notes |
| --- | --- | --- | --- |
| | | | |

## Appendix: Database-enforced rules inventory

Every rule of the seven `erp/modules/*/RULES.md` files that PostgreSQL enforces today with a
constraint, trigger, unique index, or privilege, found by reading the rule text against
`db/schema` and `db/migrations`. Each row names the objects, so a rule that loses its check can be
found by searching for them. 41 of the 66 rules appear; the other 25 are enforced in application
code, by a test, or by review.

"Class" is the class in [ADR-0124](../../decisions/0124-adopt-alchemy-domain-in-phases.md#what-adoption-changes).
"Moves to" is where the check goes when the rule's aggregate leaves the tables, decided in phase 0
and pending owner confirmation:

- **decide**: checked inside the aggregate's `decide`, from its own state or from a stable read at
  command time. A foreign key that crossed aggregates becomes that command-time read.
- **claim**: a claim aggregate keyed by the unique value; the command reserves the key and a
  compensation releases it.
- **derived id**: the aggregate id is derived from the unique value, so uniqueness holds by
  construction.
- **event log**: the recorded events replace an append-only table, protected by the domain object
  store trigger (deliverable 5).
- **projection**: a derived total is kept by a projection and a reconciliation story, with a lag.
- **table**: the check stays on its table, because the aggregate stays table-backed in this track.

| Rule | Class | PostgreSQL enforces with | Moves to |
| --- | --- | --- | --- |
| `ACC-OPEN-1` | C | partial unique index `journal_entries_opening_balance_key`; unique `journal_entries_reference_key` | table: the journal belongs to the ledger, which is not in this track |
| `ACC-OPEN-4` | A | triggers `journal_entries_immutable_trigger`, `journal_lines_immutable_trigger` | table: ledger authority has its own ADR |
| `BIL-RENDER-2` | A | triggers `invoice_render_inputs_immutable_trigger`, `invoice_artifacts_immutable_trigger`, `invoice_render_inputs_no_truncate_trigger`, `invoice_artifacts_no_truncate_trigger`; unique `invoice_render_inputs_invoice_key`, `invoice_artifacts_invoice_key`; foreign key `invoice_artifacts_render_input_fkey`; checks `invoice_artifacts_pages_check`, `invoice_artifacts_fence_scope_check`, `invoice_artifacts_lease_generation_check` | table while rendering is staged (`BIL-RENDER-1`); with the invoice aggregate, a write-once artifact event checked in `decide` (event log) |
| `BIL-DOC-1` | E | unique `invoices_legal_entity_kind_number_key`, `invoices_tenant_id_number_kind_key`, `issued_numbers_series_value_key`, `issued_numbers_series_document_key`, `issued_numbers_tenant_series_number_key`; check `invoices_amounts_check` | table: numbering and the posting stay in one PostgreSQL transaction unless the accounting owner accepts a saga |
| `BIL-SET-1` | A | check `invoices_amounts_check` (open amount between zero and total), `invoice_settlements_amount_check`; deferred triggers `billing_invoice_open_amount_trigger`, `billing_settlement_open_amount_trigger`; trigger `billing_invoice_settlements_immutable_trigger` | decide: the invoice holds its open amount and refuses a settlement above it |
| `BIL-BILL-2` | A | checks `approval_requests_separation_of_duties_check`, `approval_requests_decision_check` (the approver is not the requester; the covering amount is application code) | table: Approvals stays table-backed, as for `PRC-REL-1` |
| `BIL-CREDIT-1` | D | check `invoices_credit_reference_check`; foreign key `invoices_credited_invoice_fkey` | decide for the credited quantity; the foreign key becomes a command-time read of the credited document |
| `INV-STOCK-1` | A | checks `stock_balances_on_hand_check`, `reservations_quantity_check`; deferred triggers `inventory_reservation_balance_consistency_trigger`, `inventory_stock_balance_reservation_consistency_trigger`, `inventory_movement_on_hand_consistency_trigger`, `inventory_stock_balance_on_hand_consistency_trigger`; trigger `inventory_reservation_state_transition_trigger` | decide: on hand and reserved quantity live in one stock item instance |
| `INV-STOCK-2` | A | triggers `inventory_movement_immutability_trigger`, `inventory_valuation_entries_immutable_trigger`; check `movements_quantity_check` | event log: the movements are the events |
| `INV-STOCK-3` | B | unique `movements_tenant_idempotency_key`, `reservations_tenant_idempotency_key` | decide with the host's receipt per command id; a key reused against another stock item needs a claim |
| `INV-STOCK-5` | A | foreign keys `warehouses_tenant_legal_entity_fkey`, `warehouses_tenant_legal_entity_branch_fkey`, `stock_transfers_source_warehouse_scope_fkey`, `stock_transfers_destination_warehouse_scope_fkey`; trigger `inventory_movement_reservation_reference_trigger` | decide, with the warehouse's legal entity and branch read at command time |
| `INV-XFER-1` | E | triggers `inventory_stock_transfer_initial_state_trigger`, `inventory_stock_transfer_state_transition_trigger`, `inventory_stock_transfer_line_immutability_trigger`; deferred trigger `inventory_completed_transfer_receipts_trigger`; check `stock_transfer_lines_quantity_check` | table: all-or-nothing deduction across lines stays in one transaction |
| `INV-VAL-1` | D | deferred triggers `inventory_valuation_entry_consistency_trigger`, `inventory_item_valuation_consistency_trigger`; trigger `inventory_valuation_entries_immutable_trigger` | decide: each event carries `onHandAfter` and `valueAfter`, as in the pilot; projection for the equality with the inventory account |
| `INV-VAL-2` | D | unique `valuation_entries_movement_key`, `valuation_entries_source_item_key` | decide: the stock item's state records the source documents it has moved |
| `INV-OPEN-3` | A | check `opening_stock_positions_approval_check` | decide |
| `INV-OPEN-4` | C | unique `opening_stock_positions_warehouse_item_key`, `opening_stock_positions_movement_key` | claim keyed by warehouse and item |
| `PRC-PO-1` | A | triggers `purchase_order_initial_state_trigger`, `purchase_order_mutation_trigger`, `purchase_order_line_mutation_trigger`; deferred triggers `purchase_order_total_trigger`, `purchase_order_line_total_trigger` | decide: a confirmed order refuses every command that changes it |
| `PRC-PO-2` | A | deferred triggers `purchase_order_draft_total_trigger`, `purchase_order_line_draft_total_trigger`; checks `purchase_orders_total_check`, `purchase_order_lines_quantity_check`, `purchase_order_lines_unit_price_check` | decide: the total is derived in the event |
| `PRC-PO-3` | B | unique `purchase_orders_tenant_confirmation_idempotency_key` | decide with the host's receipt per command id; a key reused on another order needs a claim |
| `PRC-PO-4` | A | foreign keys `purchase_orders_tenant_id_fkey`, `purchase_orders_tenant_supplier_account_fkey`, `purchase_order_lines_tenant_order_fkey` | decide: the service builds the instance id from the caller's tenant; the Supplier Account is read at command time |
| `PRC-SUP-1` | C | unique `supplier_accounts_tenant_supplier_relationship_key`; foreign key `supplier_accounts_tenant_supplier_relationship_fkey` | derived id from the supplier relationship; the relationship is read from Party at command time |
| `PRC-PRICE-1` | A | primary key of `supplier_prices` (tenant, supplier account, product); check `supplier_prices_unit_price_check` | decide: the instance id is the supplier account and product |
| `PRC-REL-1` | A | checks `approval_requests_separation_of_duties_check`, `approval_requests_decision_check` | table: Approvals is a framework module that stays table-backed; the order reads the decision through its contract |
| `PRC-RCPT-1` | D | unique `purchase_receipts_tenant_idempotency_key`; deferred triggers `purchase_receipt_line_quantity_trigger`, `purchase_order_line_receipt_quantity_trigger`; triggers `purchase_receipt_immutability_trigger`, `purchase_receipt_line_immutability_trigger` | decide on the purchase order (received at most ordered per line); the receipt's idempotency by command id |
| `PRC-VRCPT-1` | D | deferred trigger `purchase_receipt_line_quantity_trigger` (constraint `purchase_receipt_lines_ordered_quantity_check`); unique `purchase_receipts_tenant_idempotency_key` | decide on the purchase order |
| `PRC-RET-1` | E | checks `purchase_return_lines_quantity_check`; unique `purchase_returns_tenant_order_id_key` (the "at most what was received" cap is a row lock, not a constraint) | table |
| `SAL-ORDER-1` | A | triggers `sales_order_initial_state_trigger`, `sales_terminal_order_mutation_trigger`, `sales_terminal_order_line_mutation_trigger`; deferred triggers `sales_terminal_order_total_trigger`, `sales_terminal_order_line_total_trigger` | decide: the pilot's order state union and `order-lifecycle.ts` |
| `SAL-ORDER-2` | B | unique `orders_tenant_confirmation_idempotency_key` | decide with the host's receipt per command id; a key another order used needs a claim |
| `SAL-ORDER-3` | A | foreign keys `orders_tenant_customer_fkey`, `orders_tenant_quotation_fkey`, `orders_tenant_quotation_customer_fkey`, `order_lines_tenant_order_fkey`, `orders_legal_entity_fkey`; checks `order_lines_quantity_check`, `order_lines_unit_price_check` | decide: tenant from the instance id; the quotation's customer read at command time |
| `SAL-CUST-1` | C | check `customers_email_normalization_check`; unique `customers_tenant_email_key` | claim keyed by tenant and canonical email; the canonical form is a Schema on the command |
| `SAL-CUST-2` | A | unique `customers_tenant_party_relationship_key`; foreign keys `customers_party_relationship_fkey`, `customers_legal_entity_fkey` | derived id from the party relationship; Party and the legal entity read at command time |
| `SAL-PRICE-1` | C | unique `price_lists_tenant_name_key`; checks `price_lists_currency_check`, `price_list_items_unit_price_check` | claim keyed by tenant and list name |
| `SAL-QUOT-1` | A | checks `quotations_total_check`, `quotation_lines_quantity_check` | decide |
| `SAL-DLV-1` | D | unique `delivery_lines_delivery_order_line_key`, `deliveries_legal_entity_number_key`; check `delivery_lines_quantity_check` (the cumulative cap is a row lock, not a constraint) | decide on the sales order: delivered at most ordered, as in the pilot |
| `SAL-CREDIT-1` | E | check `customers_credit_limit_check` (a non-negative limit only; the exposure test is application code) | table |
| `SET-BANK-1` | A | checks `bank_statement_lines_amount_check` (non-zero), `bank_statement_lines_number_check` | decide: the rest of the profile is parsed before the command |
| `SET-BANK-2` | C | unique `bank_statements_checksum_key`; check `bank_statements_checksum_check`; triggers `settlement_bank_statements_immutable_trigger`, `settlement_bank_statement_lines_immutable_trigger`, `settlement_bank_line_matches_immutable_trigger` | claim keyed by tenant, legal entity, bank account, and checksum (or a statement id derived from them, so a repeat is the same instance); event log for immutability |
| `SET-BANK-3` | E | deferred trigger `settlement_bank_line_matches_match_trigger` (same legal entity and bank account, direction, at most the line, at most the payment's cash); check `bank_line_matches_amount_check` | table |
| `SET-WHT-1` | D | deferred triggers `settlement_payment_withholding_trigger`, `settlement_payment_unallocated_trigger`, `settlement_allocation_unallocated_trigger`; check `payment_allocations_amount_check` | table until the accounting owner accepts an unapplied-cash state |
| `TAX-RATE-1` | A | primary key of `tax_code_rates` (tenant, tax code, effective from); check `tax_code_rates_rate_check` | decide: the periods are in the tax code's state |
| `TAX-PROD-1` | A | foreign keys `product_tax_defaults_tax_code_fkey` (tenant, code, direction), `product_tax_defaults_product_fkey` | decide: Product reads the code through the Tax contract at command time; the open gate in the roadmap stands until then |

**Enforced by row locks, not constraints** (these have no database check to move and each needs a
story for the race it closes): `BIL-INV-1`, `BIL-BILL-1`, `SAL-CREDIT-2`, `SAL-QUOT-3`, and the
cumulative caps of `SAL-DLV-1` and `PRC-RET-1`.

**Database checks no rule names.** Journal balance (`journal_entries_balanced_trigger`), period and
journal state machines, financial operation and cutover controls, the payment allocation and
reservation state triggers, and job and workflow initial states are outside the 66 rules. Whoever
moves an aggregate they guard inherits the same question.

**Every rule the "Five views" section names is in the table:** `ACC-OPEN-4`, `INV-STOCK-2`,
`SET-BANK-2`, `INV-VAL-1`, `SAL-ORDER-1`, `SAL-ORDER-3`, `SAL-CUST-1`, `PRC-PO-1`, `PRC-REL-1`,
`TAX-PROD-1`, `BIL-RENDER-2`.
