# Proposal: ERP Build-out Handoff

> **Status:** Working note, written 2026-11-03 at the end of a long agent-assisted build-out. It is a
> proposal until each backlog item gets its own branch.
>
> **Owns:** A tool-neutral snapshot for any engineer or coding agent who continues the ERP build-out
> with no memory of how it got here: what is done, what is open, the owner's standing decisions, the
> big design in one page, and the traps that cost time.
>
> **Does not own:** The phases and decisions D1–D12 ([parity plan](./erp-module-parity-plan.md)), the
> follow-up table F1–F7 ([next steps](./erp-chains-next-steps.md)), or any rule that an ADR or
> architecture document owns. Where this note and those disagree, they win; fix this note.
>
> **Related documents**
>
> - Agent rules: [`../../AGENTS.md`](../../AGENTS.md)
> - ERP parity plan: [`./erp-module-parity-plan.md`](./erp-module-parity-plan.md)
> - Next steps and follow-ups: [`./erp-chains-next-steps.md`](./erp-chains-next-steps.md)
> - ADR index: [`../decisions/README.md`](../decisions/README.md)
> - Documentation boundaries: [`../documentation-boundaries.md`](../documentation-boundaries.md)

## 1. Read this first

1. Read [`AGENTS.md`](../../AGENTS.md). It is the executable rule set and applies to every tool.
2. Read sections 2 to 4 of this note, then the follow-up table in
   [`erp-chains-next-steps.md`](./erp-chains-next-steps.md) section 4.
3. Pick one backlog item (section 5), branch from `main`, and read the ADR it names before coding.

Nothing here lives in any assistant's private memory. If a fact matters, it is in the repository.

## 2. The product in one paragraph

RITSEI is an ERP framework with a flagship ERP built on it like any third-party module
([ADR-0091](../decisions/0091-adopt-framework-and-flagship-erp.md)). The target segment is
small and mid-size Indonesian trading and distribution companies. Stack: TypeScript on Node with
pnpm, Effect v4, Drizzle on PostgreSQL (PostgreSQL does everything until measured need says
otherwise), a SolidJS web app, oxlint and oxfmt, Fallow for dead-code and boundary checks, Playwright
for browser workflow tests. The owner writes Indonesian in chat; repository documents, commits, and
code are English.

## 3. What exists on `main`

| Area | State | Proven by |
| --- | --- | --- |
| Module kernel: manifests, generated registry and routes, `ritsei new module` | Done ([ADR-0094](../decisions/0094-adopt-module-manifest-registry-and-generator.md)) | `erp/runtime/api/mod.test.ts`, drift tests |
| Ledger, gapless numbering, posting rules, fiscal calendar | Done (ADR-0095, 0096) | `erp/modules/accounting/tests`, `tests/chains/fiscal-calendar.postgres.test.ts` |
| Order-to-Cash: product, tax, customers as Party roles, quotation, delivery, invoice, credit note, receipt, aging, statement | Done (ADR-0097–0102) | `tests/chains/order-to-cash.postgres.test.ts` |
| Procure-to-Pay: supplier prices, approvals, valued receipts, returns, three-way-matched bills, payments, moving-average valuation | Done (ADR-0100, 0103, 0104) | `tests/chains/procure-to-pay.postgres.test.ts` |
| Documents module: read a document chain across modules | Built; [ADR-0107](../decisions/0107-read-document-chains-through-a-documents-module.md) is still **Proposed** | module tests |
| Credit limit: gate on order confirmation, customer lock, counts open invoices and confirmed-not-invoiced orders | Done ([ADR-0108](../decisions/0108-gate-order-confirmation-on-customer-credit-limit.md)) | `tests/chains/concurrent-commands.postgres.test.ts` (fails without the lock) |
| Custom fields as an owner extension point (Product, Sales customer; web edits the customer's) | Done ([ADR-0109](../decisions/0109-release-custom-fields-as-an-extension-point.md)) | `tests/chains/custom-fields.postgres.test.ts` |
| `localization_id` Stage A: Indonesian chart, PPN codes, NPWP/NIK checks, one setup command | Done ([ADR-0111](../decisions/0111-sequence-localization-id-on-public-contracts.md)) | `tests/chains/localization-id.postgres.test.ts` |
| Web screens | Sales, billing, settlement (payments), product, tax, approvals, identity, authorization, inventory, procurement, process studio, documents | `tests/frontend/*.test.ts` |
| Invoice PDF | The browser prints a billing document; no stored artifact, no email | n/a |

## 4. The big design in one page

- **One owner per fact.** Each module owns its tables. Others read and write only through the owner's
  public entry point (`mod.ts`) and typed service contracts. Boundary checks fail the build if you
  cheat. Never add an allowlist entry to get green.
- **Ports instead of imports when a dependency would cycle.** Sales defines `CreditExposure`; Billing
  implements it; the runtime wires it. Accounting defines `ChartTemplateRegistry` and Party defines
  `IdentifierSchemes` as optional services (`Effect.serviceOption`) that a localization provides.
- **Extension points are released contracts.** An owner declares an `extensionPoints` entry in its
  manifest; the framework stores the extra data (custom fields) in its own schema, never in the
  owner's tables. No formulas, scripts, or view patching.
- **Documents are immutable once posted.** A correction is a new document (credit note, reversal).
  Invoice artifacts will follow the same rule ([ADR-0110](../decisions/0110-issue-invoices-as-immutable-numbered-artifacts-and-send-by-communication.md)).
- **Synchronous invariants use one transaction;** facts that other modules react to go through the
  transactional outbox; single-consumer work uses a job table. No dual writes.
- **Jurisdiction lives only in a localization module** ([ADR-0016](../decisions/0016-isolate-jurisdiction-localization.md)).
  Neutral modules (Tax, Accounting, Party) stay jurisdiction-free; a second country would be a second
  module of the same shape.
- **Money is exact** ([ADR-0042](../decisions/0042-exact-financial-amount-boundary.md)): two-decimal
  base-currency amounts. There is no multi-currency posting yet.
- **Authorization is deny-by-default business capabilities,** named per module (for example
  `sales.credit_limit.configure`). Every new action needs one, and tests prove a missing grant fails.

## 5. Backlog, in the order I would take it

Each item gets its own branch from `main`. Items marked **needs owner** wait for a decision.

| # | Item | Why / scope | Start from |
| --- | --- | --- | --- |
| B1 | Accept or revise ADR-0107 (documents module) | Code exists, ADR is still Proposed | **needs owner** |
| B2 | Invoice artifacts and email (F2) | Stored immutable PDF via `pdfnative`, then manual "Send" over SMTP; automatic send later as a per-tenant setting, off by default. Rendering stays a job. The existing `pdfnative` adapter is for evaluation only; production activation requires all eight gates | ADR-0110, [`document-rendering.md`](../architecture/document-rendering.md) section 12 |
| B3 | `localization_id` Stage B | PPh 23 and PPh 4(2) withholding on supplier bills (needs a Billing extension point for withheld amounts); dated tax rates (Tax has no validity periods); Coretax e-Faktur export as a versioned adapter run by a job | ADR-0111 |
| B4 | Custom fields leftovers | Retire a field and purge values; embed values in the base DTO under a `custom` key (owner's choice); a Product screen | ADR-0109 |
| B5 | Pilot readiness | Spreadsheet import of masters and opening balances; bank statement import and manual reconciliation; profit and loss and balance sheet | Parity plan Phase 8 |
| B6 | Tests the risk list names | Two transactions settling one invoice at once; `TRUNCATE` is not blocked by any trigger; multi-currency, several legal entities per tenant, concurrent postings across entities | [`erp-chains-next-steps.md`](./erp-chains-next-steps.md) section 5 |
| B7 | Module kernel leftovers | Apply a generated migration to a live database in CI; sidebar navigation for generated modules | ADR-0094 |
| B8 | Stale documents | `architecture-spec-v4.md` still shows the pre-restructure `modules/` tree; restored target-design documents name old paths | Parity plan section 10.2 |
| B9 | Waves 9 to 12 | Finance depth (multi-currency, revaluation), supply-chain depth (lots, bins, replenishment), process engine and CRM, operational modules. Default order only; pilot evidence may change it | Parity plan section 8.2 |

Deliberately **not** planned: model inheritance and view patching, arbitrary fields on other modules'
tables, SAP condition technique, payroll in the flagship, a BI platform. Reasons are in parity plan
section 9.2.

### B2: next execution steps

The rendering foundation already has snapshot, AST, request, and artifact contracts, an in-memory
artifact store, a Purchase Order pilot, and an evaluation-only `pdfnative` adapter. The existing
tests and `pnpm run document:benchmark` provide partial evidence, not production activation. The
benchmark measures a transactional table and explicit page break, but skips the separate
`pagination-table` fixture because it requests the broader `paged-media` capability.

Gate evidence reviewed on 2026-11-04 on `codex/invoice-rendering-readiness` (not yet merged):

| Gate | Evidence and remaining work |
| --- | --- |
| Contract | Versioned evaluation snapshots and a staged Billing schema bind invoice number, render input and one checksummed PDF. Evaluation services atomically enqueue inputs, authorize artifact reads and accept artifacts with a current Process lease. A candidate worker exercises the path; trusted names at posting and production activation remain open. |
| Ownership | ADR-0102 and ADR-0110 assign invoices to Billing; the evaluation pilot is owned by Procurement. |
| Security | Evaluation checks input and asset integrity, verifies issuer/customer names against Party when first staged, rejects unversioned layout options, limits rows, pixels, asset bytes and generated output, and tests tenant-scoped reads and lease checks. Trusted names during production posting, asset normalization, sandboxing and execution-time memory limits still need evidence. |
| Determinism | The evaluation corpus produces identical PDF hashes in separate UTC and Asia/Bangkok processes on the same local runtime. Fingerprints bind asset hashes and the adapter version; version 1 evaluation inputs must be recreated. Other platforms, dependency versions and runtime environments still need evidence. |
| Conformance | Tests cover repeated table headers, row identifiers, an explicit page break, multilingual text and font resources. Independent local inspection confirmed multilingual rendering and one PNG fixture; barcode/QR scanning, other fonts and assets, and further pagination cases still need evidence. |
| Workload | Disposable PostgreSQL tests exercise the actual candidate queue and worker, atomic completion, stale leases, retries and uncertain completion. The benchmark records sequential renderer timing, CPU and process peak RSS. Worker concurrency, hard timeout, command reserve and production workload behavior remain unmeasured. |
| Operations | A Billing-owned PostgreSQL artifact store and candidate recovery path exist for disposable evaluation databases. Production storage sizing, retention, cleanup, monitoring, alerts, backups and manual recovery still need an operational design and evidence. |
| Dependency | `pdfnative` is pinned at 1.7.0 for evaluation. Its package notices and Node engine were inspected; distribution, security review and upgrade ownership still need evidence. |

The 2026-11-03 dependency inspection found the following, without approving production use:

- `package.json` and `pnpm-lock.yaml` pin `pdfnative` 1.7.0; its package declares MIT, Node >=22
  and no runtime dependencies. RITSEI requires Node >=24.22 and the local evaluation tests and
  benchmark ran on Node 24.22. These are not deployment-wide compatibility evidence.
- The installed package includes its MIT `LICENSE`, `fonts/LICENSE` (SIL Open Font License 1.1 for
  the bundled Noto font data), and `THIRD-PARTY-NOTICES.md` (also identifying Unicode License v3
  data). RITSEI itself is Apache-2.0. Inspect these files again for the exact pinned package and
  any version change; do not infer license terms from the package name alone.
- Before distributing an artifact that includes the renderer or its font data, review the included
  notices and make the applicable license texts and copyright notices available with that
  distribution. `tooling/production/artifacts.ts` currently bundles Node entry points and copies
  migrations and the web build, but has no explicit third-party-notice copy step. Verify the actual
  release artifact and embedding/subsetting treatment, rather than assuming the package's local
  files are present in the distributed bundle.
- `pnpm audit --prod --json` on that date reported no `pdfnative` advisory; it failed on existing
  `seroval` advisories in the web dependency graph. An advisory scan is not a security review.
  Inspect renderer input handling, font and image processing, release provenance and supported
  deployment runtimes, then assign an upgrade and vulnerability-response owner before activation.

1. Build and measure the staged job, Billing-owned artifact implementation and worker under
   [ADR-0112](../decisions/0112-stage-invoice-rendering-before-activation.md), using disposable
   nonproduction databases. Complete and review evidence for all eight rendering gates, including
   pagination, fidelity, isolation, determinism, workload behavior, retention and recovery, and
   dependency ownership. Do not infer a gate passes from one test or benchmark.
2. Only after the gates pass, activate the renderer in a separate change and connect Billing's
   immutable issued snapshot and render job to posting under ADR-0110. Preserve authorization,
   idempotency, fencing and recovery; downloads must return the stored artifact.
3. Add manual sending through Communication and the SMTP integration, including durable delivery
   attempts and retries. Automatic sending is a later tenant setting, off by default.

Until activation, the browser print sheet remains available. The permitted evaluation scope and
the gate definitions belong to [`document-rendering.md`](../architecture/document-rendering.md),
not this working note.

### B2: candidate operational approach

This is a proposal for reviewing production gate evidence, not a production retention promise or
an exception to the rendering architecture's current implementation
boundary. The governing rules remain in [`document-rendering.md`](../architecture/document-rendering.md),
[`durable-execution.md`](../architecture/durable-execution.md), and
[`state-and-consistency.md`](../architecture/state-and-consistency.md).

- **Storage and commit:** The first candidate is bounded PDF bytes and metadata in PostgreSQL,
  subject to measured size and capacity. Use the Billing-owned invoice identity and snapshot and
  public job contract. Design the artifact write and job completion so a crash cannot publish two
  artifacts or acknowledge work with no artifact; the accepting mutation must enforce the active
  fence generation. If the worker loses the commit response, inspect the committed job and artifact
  and compare the expected identity and hash before retrying. A conflict goes to manual recovery,
  not an overwrite or a new rendering of an issued artifact.
- **Alternative storage:** An external object store is not selected. Consider it only for a measured
  need; a candidate must specify immutable object identity, digest verification, authorization,
  staged uploads, unknown-outcome reconciliation and orphan cleanup without treating two writes as
  one transaction. Recovery and retention must be proven before activation.
- **Cleanup and retention:** Clean temporary render files and failed staging data with bounded,
  observable cleanup after the associated work is resolved. Do not delete an issued artifact as
  routine retry cleanup. Retention duration, backup and restore, legal holds, deletion authority,
  and storage limits still need a deployment decision and recovery evidence.
- **Worker capacity:** Evaluate a separate bounded render worker and database pool, with configured
  CPU, memory, concurrency and timeout budgets. Measure normal commands while the render workload
  saturates those budgets; process separation alone does not establish command reserve. A renderer
  timeout also needs a way to stop or recycle the actual work, not merely abandon a waiting fiber.
- **Operations:** Record bounded queue wait, duration, failure, retry, resource and artifact-size
  measurements; keep document and tenant identities out of metric labels. Alert on sustained queue
  delay, exhausted retries, failures and storage pressure using thresholds chosen from deployment
  measurements. For manual recovery, an authorized operator inspects job status, lease generation,
  artifact identity and hash, and the last failure; reconcile an unknown commit before retrying,
  and escalate conflicts instead of deleting issued evidence. Correlation records should not expose
  invoice content or credentials.

The 2026-11-03 Process, financial worker and memory-store tests cover generic job and fencing
behavior. The newer disposable-database Billing and worker tests additionally exercise renderer
jobs, atomic storage, lease loss, retries and uncertain completion; they do not establish resource
limits or satisfy the workload or operational gate. The renderer benchmark measures the evaluation
adapter, not a protected production worker. Production storage sizing, timeout/retry values,
operational owners, alert thresholds and retention policy remain unselected.

Open owner questions that still affect scope (parity plan section 11): whether supplier bills should
live in Billing or Procurement (the code puts them in Billing, per D2); whether the first pilots need
lots and expiry dates in month one; which operational module a pilot is most likely to ask for.

## 6. Owner decisions already made (do not reopen without a new ADR)

- Coretax output is **not** required in the first pilot month; PPN is calculated from tax codes.
- Invoice renderer is `pdfnative`, activated only after its eight gates pass.
- Email transport is SMTP first; sending is a manual action first, automatic as a tenant setting later.
- Custom fields (ADR-0109) were approved and built before localization Stage A.
- The credit limit counts confirmed-not-invoiced orders and runs under a customer lock (ADR-0108).
- ADRs 0108 to 0111 are Accepted. New decisions are written as ADRs; accepted ones are superseded,
  never edited.

## 7. How the work was run

- **Branch per item from `main`, one PR each, merged with a merge commit** after CI is green. The
  owner confirms each batch of merges. Delete the remote branch afterwards. (An earlier
  experiment used one long-lived integration branch pushed without PRs; that ended when it merged
  in #17.)
- **Commits** follow [`commit-message-guidelines.md`](../development/commit-message-guidelines.md).
  The commit-msg hook rejects default merge messages and subjects over 72 characters; use
  `chore(merge): bring main into <branch>`. A pre-commit hook formats staged files.
- **Report honestly:** say what was verified (command and result) and what was not. The server has
  no build; the web app does (`pnpm --filter @ritsei/web run build`).
- **Do the smallest change that solves the task.** The repository rejects speculative abstractions.

## 8. Commands that matter

```sh
pnpm run fmt:check && pnpm run lint && pnpm run check   # format, lint, types
pnpm run check:affected                                  # tests for what you touched
pnpm run boundary:test && pnpm run boundary:lint         # architecture rules
pnpm run fallow:audit                                    # dead code, duplication, health
pnpm run ritsei gen                                      # regenerate after a manifest change
pnpm run db:generate                                     # new Drizzle migration
pnpm run test                                            # full suite, as CI runs it
```

- Chain tests under `tests/chains` need PostgreSQL 19 (`DATABASE_URL`); they create temporary
  databases through `withTemporaryDatabase`. The author ran PostgreSQL in WSL2 on Windows
  ([`windows-wsl.md`](../development/windows-wsl.md)); CI provides it.
- Browser workflow tests are Playwright against the built web app (`tests/frontend`, helpers
  `mockRoutes`, `fulfillJson`, axe checks). Regenerate web contracts and styles with
  `pnpm run contracts` and `pnpm run styles` (`check` does both).

## 9. Traps that cost time

- **Lint rules are strict and bespoke.** Avoid `typeof` (use Effect `Predicate`), conditional
  empty-object spreads, dictionary types that widen known keys (use a `Map`), manual `_tag`
  comparisons (use `Option.isNone` and similar), and missing readable blank lines. Run
  `pnpm run lint` before pushing; it is faster than a CI round trip.
- **Do not import a framework service constructor directly;** wrap it through the module's layer
  helpers (for example `ownerCustomFieldsLayer`). A lint rule enforces this.
- **Service inputs take the encoded type of their schema and still decode** (ADR-0105, ADR-0106).
- **Never use `crypto.randomUUID()` for persistent ids or fixtures;** use UUIDv7 helpers.
- **Effect is v4.** `Effect.catch`, `Effect.catchCause`, `Effect.mapError`; never the v3 names. Check
  `vendor/effect`.
- **Never hand-edit `*.gen.ts`** or Drizzle snapshots; regenerate them. Drizzle snapshots dominate
  diff size (about 300,000 added lines in #17), so review source files, not snapshots.
- **Docs tables:** a blank line inside a Markdown table ends it, and a script that rewrites table
  rows can silently drop a column. The F-table in `erp-chains-next-steps.md` was damaged this way
  once; diff it after any scripted edit.
- **Merge conflicts recur in three places:** the ADR index (`docs/decisions/README.md`), the F-table
  above, and the OpenAPI assertions in `erp/runtime/api/mod.test.ts` (keep both sides' blocks).
- **A known flaky test:** `tests/frontend/customer-credit-workflow.test.ts` failed once in CI at the
  first "No limit" wait, then passed on rerun and in 3 of 3 local runs. Its mocks do not cover the
  customer custom-fields endpoints; unmocked requests are a possible but unproven cause. If it fails
  again, mock `GET /sales/custom-fields` and `GET /sales/customers/:id/custom-fields` before
  loosening any wait.
- **On Windows with Git Bash,** nested quoting in `node -e` and heredocs breaks easily. Write a
  script file and run it instead.
- **A PR's `push` and `pull_request` CI runs can disagree** on the same commit when a test is flaky;
  compare them before assuming a code regression.

## 10. Handoff checklist for the next agent

1. `git fetch origin && git checkout -b <type>/<topic> origin/main`.
2. Read the ADR and architecture document for the item (AGENTS.md has the table).
3. Write the contract and error first, then service, store, Postgres implementation, layer, HTTP, and
   a PostgreSQL chain or integration test that proves the invariant; add the manifest entry and run
   `pnpm run ritsei gen`.
4. Run section 8's checks that apply, then open a PR and wait for green CI.
5. Update the F-table or this backlog if the status of an item changed, in the same PR.
6. Finish with the completion report AGENTS.md asks for: what changed, validation run, docs and ADR
   changes, remaining risks.
