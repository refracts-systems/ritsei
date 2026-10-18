# PostgreSQL 19 Rehearsal

> **Status:** Development and review procedure
>
> **Owns:** disposable PostgreSQL 19 capability evidence.
>
> **Related documents**
>
> - PostgreSQL architecture:
>   [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - State and consistency:
>   [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - PostgreSQL 19 roadmap: [`../roadmap/postgresql-19.md`](../roadmap/postgresql-19.md)
> - Database roles: [`./database-roles.md`](./database-roles.md)

## Purpose

The rehearsal proves selected PostgreSQL 19 mechanics on a disposable database. It is not a
production migration, upgrade, backup, failover, or deployment procedure.

The script creates and removes only the `ritsei_pg19_rehearsal` schema in the explicitly named
review database. The database name must contain `rehearsal`, `disposable`, or `scratch`, and the
operator must repeat that exact name in `RITSEI_CONFIRM_DISPOSABLE_DATABASE`.

## Run

Configure `RITSEI_DISPOSABLE_DATABASE_URL` and
`RITSEI_CONFIRM_DISPOSABLE_DATABASE` in `.env.local`, then run:

```sh
pnpm exec varlock run -- pnpm run postgres19:rehearse
```

Optional evidence output:

Set `RITSEI_POSTGRES19_EVIDENCE_PATH` in `.env.local`, then run:

```sh
pnpm exec varlock run -- pnpm run postgres19:rehearse
```

Do not point this procedure at a production database. The command is intentionally destructive
inside its named rehearsal schema.

## Evidence

The output records:

- PostgreSQL version and whether it is production-eligible;
- `REPACK (CONCURRENTLY true, ANALYZE true)` start and finish times;
- row count and deterministic content checksum before/after;
- index validity before/after;
- `data_checksums`, `autovacuum`, `reserved_connections`, `superuser_reserved_connections`, and
  `max_repack_replication_slots`;
- whether `pg_stat_io` is available.

A Beta or release-candidate server is useful development evidence but remains **not eligible** for
production activation. On August 31, 2026 the local server reports PostgreSQL 19 Beta 3, so the
production GA gate remains open.

## Boundary

`REPACK`, autovacuum, I/O settings, checksums, replication slots, and connection reserves belong in
operational rehearsal and reviewed deployment configuration. They are not domain runtime behavior.
The read-your-writes adapter and Party graph pilot have separate route and query evidence; this
script does not claim replica failover, SQL/PGQ correctness, authorization freshness, or no-primary
fallback.

A disposable PostgreSQL test now proves that a temporary `LOGIN` non-superuser can execute the
required control-system and `WAIT FOR` calls. That probe does not prove the deployed `ritsei_*` role
matrix, query credentials cannot reach the primary, or ordinary-slot saturation preserves the
reviewed command reserve. Production review must still provide those role and workload tests.
