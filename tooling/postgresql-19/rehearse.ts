import { writeFile } from "node:fs/promises"

import postgres from "postgres"

import { isMain } from "../entrypoint.ts"

export const disposableDatabaseName = (databaseUrl: string) => {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1))
  if (!/(?:rehearsal|disposable|scratch)/i.test(name)) {
    throw new Error("rehearsal database name must contain rehearsal, disposable, or scratch")
  }
  return name
}

const databaseUrl = process.env["RITSEI_DISPOSABLE_DATABASE_URL"]
if (isMain(import.meta.url) && databaseUrl === undefined) {
  throw new Error("RITSEI_DISPOSABLE_DATABASE_URL is required")
}

if (isMain(import.meta.url)) {
  const databaseName = disposableDatabaseName(databaseUrl!)
  if (process.env["RITSEI_CONFIRM_DISPOSABLE_DATABASE"] !== databaseName) {
    throw new Error(
      `set RITSEI_CONFIRM_DISPOSABLE_DATABASE=${databaseName} to allow destructive work`,
    )
  }

  const sql = postgres(databaseUrl!, { max: 1 })
  try {
    const [version] = await sql<[{ server_version_num: string; server_version: string }]>`
      select current_setting('server_version_num') as server_version_num,
             current_setting('server_version') as server_version
    `
    if (Number(version.server_version_num) < 190000) throw new Error("PostgreSQL 19+ is required")

    await sql.unsafe("drop schema if exists ritsei_pg19_rehearsal cascade")
    await sql.unsafe("create schema ritsei_pg19_rehearsal")
    await sql.unsafe(`
      create table ritsei_pg19_rehearsal.repack_target (
        id bigint primary key,
        payload text not null,
        updated_at timestamptz not null default now()
      )
    `)
    await sql.unsafe(`
      insert into ritsei_pg19_rehearsal.repack_target (id, payload)
      select value, repeat(md5(value::text), 8)
      from generate_series(1, 20000) as value
    `)
    await sql.unsafe(`
      create index repack_target_payload_idx
      on ritsei_pg19_rehearsal.repack_target (payload)
    `)
    await sql.unsafe("delete from ritsei_pg19_rehearsal.repack_target where id % 3 = 0")
    await sql.unsafe("vacuum analyze ritsei_pg19_rehearsal.repack_target")

    const checksum = async () => {
      const [row] = await sql<[{ row_count: string; checksum: string }]>`
        select count(*)::text as row_count,
               md5(string_agg(id::text || ':' || payload, ',' order by id)) as checksum
        from ritsei_pg19_rehearsal.repack_target
      `
      return row
    }
    const indexState = async () => {
      const [row] = await sql<[{ valid: boolean; ready: boolean }]>`
        select index.indisvalid as valid, index.indisready as ready
        from pg_index as index
        join pg_class as relation on relation.oid = index.indexrelid
        join pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'ritsei_pg19_rehearsal'
          and relation.relname = 'repack_target_payload_idx'
      `
      return row
    }

    const before = await checksum()
    const beforeIndex = await indexState()
    const startedAt = new Date().toISOString()
    await sql.unsafe("REPACK (CONCURRENTLY true, ANALYZE true) ritsei_pg19_rehearsal.repack_target")
    const finishedAt = new Date().toISOString()
    const after = await checksum()
    const afterIndex = await indexState()
    const [settings] = await sql<
      [
        {
          data_checksums: string
          autovacuum: string
          reserved_connections: string
          superuser_reserved_connections: string
          max_repack_replication_slots: string
        },
      ]
    >`
      select current_setting('data_checksums') as data_checksums,
             current_setting('autovacuum') as autovacuum,
             current_setting('reserved_connections') as reserved_connections,
             current_setting('superuser_reserved_connections') as superuser_reserved_connections,
             current_setting('max_repack_replication_slots') as max_repack_replication_slots
    `
    const [io] = await sql<[{ rows: string }]>`select count(*)::text as rows from pg_stat_io`

    if (before.row_count !== after.row_count || before.checksum !== after.checksum) {
      throw new Error("REPACK changed table contents")
    }
    if (!beforeIndex.valid || !beforeIndex.ready || !afterIndex.valid || !afterIndex.ready) {
      throw new Error("REPACK left an invalid index")
    }

    const evidence = {
      schemaVersion: 1,
      generatedAt: finishedAt,
      environment: "disposable-development",
      databaseName,
      serverVersionNum: Number(version.server_version_num),
      serverVersion: version.server_version,
      productionEligible: !/(?:beta|rc|devel)/i.test(version.server_version),
      repack: {
        command: "REPACK (CONCURRENTLY true, ANALYZE true)",
        startedAt,
        finishedAt,
        rowCount: Number(after.row_count),
        checksum: after.checksum,
        indexValidBefore: beforeIndex.valid && beforeIndex.ready,
        indexValidAfter: afterIndex.valid && afterIndex.ready,
      },
      operations: {
        dataChecksums: settings.data_checksums,
        autovacuum: settings.autovacuum,
        reservedConnections: Number(settings.reserved_connections),
        superuserReservedConnections: Number(settings.superuser_reserved_connections),
        maxRepackReplicationSlots: Number(settings.max_repack_replication_slots),
        pgStatIoRows: Number(io.rows),
      },
    }
    const output = `${JSON.stringify(evidence, null, 2)}\n`
    const outputPath = process.env["RITSEI_POSTGRES19_EVIDENCE_PATH"]
    if (outputPath === undefined) console.log(output)
    else await writeFile(outputPath, output, "utf8")
  } finally {
    await sql.end()
  }
}
