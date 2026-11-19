# ADR-0115: Stage and Apply CSV Imports in an Onboarding Module

- Status: Proposed
- Date: 2026-11-19
- Amends: None
- Compatible with: ADR-0014, ADR-0015, ADR-0051, ADR-0091, ADR-0094
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Migration-first reference, sections 4B, 4C, and 4E:
>   [`../architecture/reference/migration-first-erp-comparison.md`](../architecture/reference/migration-first-erp-comparison.md)
> - Consistency rules: [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Build-out backlog item B5: [`../proposals/erp-handoff.md`](../proposals/erp-handoff.md)

## Context

A pilot customer arrives with spreadsheets and an incumbent's exports. The migration-first reference
asks for an operator path that stages a file, validates it, rehearses it without business effects,
applies it through owner commands, and resumes after an interruption without repeating an effect.

Four facts shape the design:

- Owner commands such as `PartyService.create` declare `idempotency: "unsupported"`. A retry after a
  crash between the owner's commit and a separate checkpoint would create the record twice.
- A repeat intake must recognize the same source record. That needs a namespaced identity map, not
  a business key such as a name.
- `framework/` cannot import `erp/` owner contracts (ADR-0091), and the integrations module
  (ADR-0019) governs connectors, provider adapters, and delivery to or from external providers, not
  the intake of an operator's file into owner commands.
- Nothing on `main` stages a file or records where a native record came from.

This ADR covers the first slice: one object kind (parties) read from one CSV layout. It does not
decide opening balances, valuation, cutover dates, or transfer of write authority; those are the
migration-first reference's other decisions.

## Decision

1. **A new ERP module, `onboarding`, owns import staging.** Its schema `onboarding` holds import
   batches, their parsed rows with per-record errors, and the source identity map. It depends only on
   the public entry point of the owner it writes through (`party`). It is not a framework module,
   because no second consumer exists yet (extract, do not speculate), and it does not extend
   `integrations`, whose contracts describe external providers.
2. **A batch is named by tenant, source instance, object kind, file checksum, and mapping revision.**
   The server computes the SHA-256 of the uploaded text. A unique constraint on that name makes
   staging the same file again return the same batch. A changed file, source instance, or mapping
   revision is a new batch, so an earlier rehearsal can never authorize it.
3. **The mapping revision is named by code.** The only revision is `party-csv-v1` (headers
   `source_id`, `kind`, `name`, optional `role`; other columns are ignored and never stored). A file
   problem such as a missing header fails the whole file. A bad record becomes a per-record error
   with a row number, a field, a code, and a fixed message. Errors never echo a source value.
4. **The identity map relates a source record to a native id by id only.** Its unique key is tenant,
   source instance, object kind, and stable source id, with a hash of the mapped content. A repeat
   record with the same content links to the existing native record. A record whose content changed
   after it was imported is reported as the exception `source_record_changed` and is not applied.
   Updating an imported record is out of scope for this slice. Rows with duplicate source ids in one
   file are all rejected.
5. **Apply runs one transaction per record.** The owner command (`party.create`, then
   `party.assignRole` when a role is mapped), the identity-map insert, and the row checkpoint commit
   together or not at all. The map's unique key, not a prior read, is the duplicate guard; a violation
   rolls the record back and is rerun once, which then links to the record that won. Resuming is
   calling apply again on durable row state. There is no job table or lease in this slice: a batch is
   capped at 2,000 rows and the request body at 1 MiB, so one call stays bounded.
6. **Rehearsal is validation, not a posting rehearsal.** It reads the identity map, writes only the
   onboarding tables (row errors, the saved preview with counts, error codes, and duration), and calls
   no owner command, so it publishes no event and consumes no numbering. It does not prove that
   authorization, posting, or numbering will succeed. Apply requires a saved rehearsal of the same
   batch and refuses a batch with blocking errors.
7. **Apply runs under the operator's principal.** The operator needs the onboarding capabilities
   (`onboarding.import.stage`, `.read`, `.rehearse`, `.apply`) and the owner's own capabilities
   (`party.create`, `party.party_role.assign`). The import grants no owner privilege.
8. **Staging keeps mapped fields of valid rows, never the raw file.** Invalid rows store no source
   values. Retention and deletion of staged data are not decided here.

## Alternatives Considered

- **A framework `import` module.** Rejected for now: it would need owner contracts it cannot import,
  and the generic shape is unknown until a second object kind exists.
- **Extending `integrations`.** Rejected: its catalog, delivery store, and reliability model describe
  external provider calls, not an operator file feeding owner commands.
- **Adding idempotency keys to every owner command.** Sound, and a candidate for later, but it widens
  every owner's contract for one consumer. The same-transaction identity map gives exactly-once effects
  now without changing an owner.
- **A job table with leases for apply.** Rejected for the first slice because the batch size is bounded.
  It becomes the right primitive when batches grow or opening-balance loads are slow.
- **Writing owner tables directly.** Forbidden (ADR-0015).
- **Updating an already imported record.** Deferred: it needs an owner update command and an agreed
  conflict policy.

## Consequences

### Positive

- A retry, resume, or concurrent second import cannot create a record twice; the guarantee rests on a
  database constraint and a single transaction, and is tested against PostgreSQL.
- The identity map gives later imports (products, open documents) the same source-to-native link.
- Every blocker has a row, a field, and a code an operator can act on.

### Negative

- Each imported record appends the owner's normal event (`party.created`) to the outbox, because the
  owner command is the real one. No module manifest consumes `party.created` today, so an import
  triggers no reaction yet. A future consumer would react to imports as to native creation, and
  whether imports need a way to suppress routine outbound notifications is not decided here.
- Per-record errors page by row number (`afterRowNumber`, at most 500 rows per page; 200 over HTTP).
- A batch has no web screen yet; the path is the HTTP API.
- A changed source record is reported and stays blocked until a later slice defines updates.

### Risks

- An owner command that publishes to an external system inside the transaction would break the
  per-record guarantee. Today `party.create` appends only to the transactional outbox.
- A batch larger than the cap needs a job-based apply and a decision on lease and fencing.
- Staged names of people are personal data under UU PDP. A retention and deletion policy is needed
  before a pilot loads real files.

## Validation

- Module tests cover CSV reading, per-record errors without leaked values, idempotent staging,
  rehearsal without effects, apply, resume after an injected failure, namespaces, and authorization.
- PostgreSQL tests prove that a failure after the owner write rolls back the owner record, its outbox
  event, and the map entry together, and that two concurrent imports of the same source ids create each
  record once. They need `DATABASE_URL` and run in CI.

## Related Documents

- [Migration-first reference](../architecture/reference/migration-first-erp-comparison.md)
- [ADR-0014: Separate internal and external identifiers](./0014-separate-internal-and-external-identifiers.md)
- [ADR-0015: One semantic owner per invariant](./0015-one-semantic-owner-per-invariant.md)
- [ADR-0051: UUIDv7 for persistent identities](./0051-adopt-uuidv7-for-persistent-identities.md)
- [ADR-0094: Module manifest, registry, and generator](./0094-adopt-module-manifest-registry-and-generator.md)
