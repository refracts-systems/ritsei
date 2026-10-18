import { assert, describe, it } from "@effect/vitest"
import { readFileSync } from "node:fs"

import { disposableDatabaseName } from "../../tooling/postgresql-19/rehearse.ts"

const read = (path: string) => readFileSync(path, "utf8")

describe("PostgreSQL 19 capability boundaries", () => {
  it("keeps the Party graph read projection tied to relational facts", () => {
    const migration = read("db/migrations/20260831124952_add_party_property_graph/migration.sql")

    // SQL/PGQ (CREATE PROPERTY GRAPH / GRAPH_TABLE) was reverted upstream from
    // PostgreSQL 19 after beta 3, so the projection is expressed with plain
    // relational joins while preserving the same bounded read path.
    assert.isFalse(migration.includes("CREATE PROPERTY GRAPH"))
    assert.isFalse(migration.includes("GRAPH_TABLE"))
    assert.isTrue(migration.includes("CREATE VIEW"))
    assert.isTrue(migration.includes("party_relationships"))
    assert.isTrue(migration.includes("legal_entity_organization_edges"))
    assert.isTrue(migration.includes('"relationship"."active"'))
    assert.isFalse(migration.includes("INSERT INTO"))
    assert.isFalse(migration.includes("UPDATE "))
    assert.isFalse(migration.includes("DELETE FROM"))
  })

  it("requires explicit disposable-database confirmation", () => {
    assert.strictEqual(
      disposableDatabaseName("postgresql://postgres:postgres@127.0.0.1:5433/ritsei_scratch"),
      "ritsei_scratch",
    )
    assert.throws(() =>
      disposableDatabaseName("postgresql://postgres:postgres@127.0.0.1:5433/ritsei"),
    )
  })

  it("keeps operational rehearsal evidence separate from production eligibility", () => {
    const rehearsal = read("tooling/postgresql-19/rehearse.ts")
    const operations = read("docs/operations/postgresql-19.md")
    const evidence = JSON.parse(read("docs/operations/postgresql-19-evidence-2026-08-31.json")) as {
      readonly serverVersionNum: number
      readonly productionEligible: boolean
      readonly repack: {
        readonly rowCount: number
        readonly checksum: string
        readonly indexValidAfter: boolean
      }
    }

    assert.isTrue(rehearsal.includes("REPACK (CONCURRENTLY true, ANALYZE true)"))
    assert.isTrue(rehearsal.includes("pg_stat_io"))
    assert.isTrue(rehearsal.includes("productionEligible"))
    assert.isTrue(operations.includes("not eligible"))
    assert.isTrue(operations.includes("production migration"))
    assert.isAtLeast(evidence.serverVersionNum, 190000)
    assert.isFalse(evidence.productionEligible)
    assert.isAbove(evidence.repack.rowCount, 0)
    assert.isTrue(evidence.repack.checksum.length > 0)
    assert.isTrue(evidence.repack.indexValidAfter)
  })
})
