import { createHash } from "node:crypto"

import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { uuidv7 } from "../../framework/foundation/mod.ts"
import { AuthorizationDenied } from "../../framework/modules/authorization/mod.ts"
import { runMigrations } from "../../framework/platform/mod.ts"
import {
  BillingCapabilities,
  BillingDocumentNotFound,
  BillingService,
  ImportArtifactInput,
  ImportedArtifactConflict,
  ImportedArtifactNotFound,
  MaxImportedArtifactBytes,
} from "../../erp/modules/billing/mod.ts"
import { seedErpFixture } from "../support/erp-fixture.ts"
import { erpChainLayers } from "../support/erp-layers.ts"
import { postgresConstraint } from "../support/postgres-error.ts"
import { withTemporaryDatabase } from "../support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]
const importer = { userAccountId: "artifact-importer", sessionId: "importer-session" }
const reader = { userAccountId: "artifact-reader", sessionId: "reader-session" }
const otherReader = { userAccountId: "artifact-other-reader", sessionId: "other-session" }
const stranger = { userAccountId: "artifact-stranger", sessionId: "stranger-session" }

type ImportRequest = Schema.Codec.Encoded<typeof ImportArtifactInput>

const postgresFailure = <A>(effect: () => Promise<A>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF`)
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

it.effect.skipIf(databaseUrl === undefined)(
  "retains imported document bytes once per source document, immutably, behind separate capabilities",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const fixture = yield* seedErpFixture(client)
        const { tenantId } = fixture

        const otherFixture = yield* seedErpFixture(client)
        const otherTenantId = otherFixture.tenantId

        const grants = [
          {
            userAccountId: importer.userAccountId,
            tenantId,
            capability: BillingCapabilities.importedArtifactImport,
          },
          {
            userAccountId: reader.userAccountId,
            tenantId,
            capability: BillingCapabilities.documentRead,
          },
          {
            userAccountId: otherReader.userAccountId,
            tenantId: otherTenantId,
            capability: BillingCapabilities.documentRead,
          },
          {
            userAccountId: importer.userAccountId,
            tenantId: otherTenantId,
            capability: BillingCapabilities.importedArtifactImport,
          },
        ]

        yield* Effect.gen(function* () {
          const billing = yield* BillingService

          const bytes = pdf("invoice INV-2025-001")

          const request = (overrides: Partial<ImportRequest> = {}) => ({
            principal: importer,
            tenantId,
            sourceSystem: "legacy_erp",
            sourceReference: "INV-2025-001",
            filename: "INV-2025-001.pdf",
            mediaType: "application/pdf",
            content: base64(bytes),
            ...overrides,
          })

          // The server hashes the bytes it was given; the caller has no way to supply a digest.
          const first = yield* billing.importArtifact(request())

          assert.strictEqual(first.duplicate, false)
          assert.strictEqual(first.artifact.contentHash, sha256(bytes))
          assert.strictEqual(first.artifact.byteSize, bytes.byteLength)
          assert.strictEqual(first.artifact.invoiceId, null)
          assert.strictEqual(first.artifact.importedBy, importer.userAccountId)

          // A re-import of the same evidence returns the stored record and stores nothing new.
          const replay = yield* billing.importArtifact(request())

          assert.strictEqual(replay.duplicate, true)
          assert.deepStrictEqual(replay.artifact, first.artifact)

          const [count] = yield* Effect.promise(
            () => client<{ total: number }[]>`
              select count(*)::int as total from billing.imported_artifacts where tenant_id = ${tenantId}
            `,
          )

          assert.strictEqual(count!.total, 1)

          // The same source document with other bytes or other metadata is a conflict, not a copy.
          const otherBytes = yield* Effect.flip(
            billing.importArtifact(request({ content: base64(pdf("edited")) })),
          )

          assert.instanceOf(otherBytes, ImportedArtifactConflict)

          const otherName = yield* Effect.flip(
            billing.importArtifact(request({ filename: "renamed.pdf" })),
          )

          assert.instanceOf(otherName, ImportedArtifactConflict)

          // Another source reference, another source system, and another tenant are other documents.
          const otherReference = yield* billing.importArtifact(
            request({ sourceReference: "INV-2025-002" }),
          )

          const otherSystem = yield* billing.importArtifact(request({ sourceSystem: "other_erp" }))
          const otherTenant = yield* billing.importArtifact(request({ tenantId: otherTenantId }))

          assert.strictEqual(otherReference.duplicate, false)
          assert.strictEqual(otherSystem.duplicate, false)
          assert.strictEqual(otherTenant.duplicate, false)
          assert.notStrictEqual(otherTenant.artifact.id, first.artifact.id)

          // Reading returns the exact bytes under the document read capability.
          const downloaded = yield* billing.getImportedArtifact({
            principal: reader,
            tenantId,
            artifactId: first.artifact.id,
          })

          assert.deepStrictEqual(downloaded.content, bytes)
          assert.strictEqual(downloaded.contentHash, first.artifact.contentHash)
          assert.strictEqual(downloaded.filename, "INV-2025-001.pdf")

          // Authorization is deny by default, and importing is not reading.
          const unauthorizedImport = yield* Effect.flip(
            billing.importArtifact(request({ principal: stranger })),
          )

          const readerCannotImport = yield* Effect.flip(
            billing.importArtifact(request({ principal: reader })),
          )

          const importerCannotRead = yield* Effect.flip(
            billing.getImportedArtifact({
              principal: importer,
              tenantId,
              artifactId: first.artifact.id,
            }),
          )

          const strangerCannotRead = yield* Effect.flip(
            billing.getImportedArtifact({
              principal: stranger,
              tenantId,
              artifactId: first.artifact.id,
            }),
          )

          assert.instanceOf(unauthorizedImport, AuthorizationDenied)
          assert.instanceOf(readerCannotImport, AuthorizationDenied)
          assert.instanceOf(importerCannotRead, AuthorizationDenied)
          assert.instanceOf(strangerCannotRead, AuthorizationDenied)

          // A grant in one tenant gives nothing in another, and a record is invisible across tenants.
          const readerOutsideTenant = yield* Effect.flip(
            billing.getImportedArtifact({
              principal: reader,
              tenantId: otherTenantId,
              artifactId: otherTenant.artifact.id,
            }),
          )

          const crossTenantRead = yield* Effect.flip(
            billing.getImportedArtifact({
              principal: otherReader,
              tenantId: otherTenantId,
              artifactId: first.artifact.id,
            }),
          )

          assert.instanceOf(readerOutsideTenant, AuthorizationDenied)
          assert.instanceOf(crossTenantRead, ImportedArtifactNotFound)

          // Input limits: empty bytes, more than the hard limit, and a hostile filename are refused.
          const empty = yield* Effect.flip(
            billing.importArtifact(request({ sourceReference: "empty", content: "" })),
          )

          const oversized = yield* Effect.flip(
            billing.importArtifact(
              request({
                sourceReference: "large",
                content: base64(new Uint8Array(MaxImportedArtifactBytes + 1)),
              }),
            ),
          )

          const pathName = yield* Effect.flip(
            billing.importArtifact(request({ sourceReference: "path", filename: "../x.pdf" })),
          )

          assert.instanceOf(empty, Schema.SchemaError)
          assert.instanceOf(oversized, Schema.SchemaError)
          assert.instanceOf(pathName, Schema.SchemaError)

          // An invoice that is not in the tenant is a business failure, not a database one.
          const unknownInvoice = yield* Effect.flip(
            billing.importArtifact(request({ sourceReference: "linked", invoiceId: uuidv7() })),
          )

          assert.instanceOf(unknownInvoice, BillingDocumentNotFound)

          // An invoice of the tenant links the bytes; another tenant's invoice does not.
          const [invoice] = yield* Effect.promise(
            () => client<{ id: string }[]>`
              insert into billing.invoices
                (tenant_id, legal_entity_id, kind, party_id, number, invoice_date, subtotal,
                 tax_total, total, open_amount, journal_entry_id)
              values (${tenantId}, ${fixture.legalEntityId}, 'customer_invoice',
                ${fixture.organizationId}, 'INV/SQL/1', '2025-12-01', 100.00, 0.00, 100.00, 100.00,
                ${uuidv7()})
              returning id
            `,
          )

          const linked = yield* billing.importArtifact(
            request({ sourceReference: "linked-ok", invoiceId: invoice!.id }),
          )

          assert.strictEqual(linked.artifact.invoiceId, invoice!.id)

          const foreignInvoice = yield* Effect.flip(
            billing.importArtifact(
              request({
                tenantId: otherTenantId,
                sourceReference: "linked-foreign",
                invoiceId: invoice!.id,
              }),
            ),
          )

          assert.instanceOf(foreignInvoice, BillingDocumentNotFound)

          // Two first imports of one source document at once leave one record and both succeed.
          const race = yield* Effect.all(
            [
              billing.importArtifact(request({ sourceReference: "race" })),
              billing.importArtifact(request({ sourceReference: "race" })),
            ],
            { concurrency: 2 },
          )

          assert.strictEqual(race[0].artifact.id, race[1].artifact.id)
          assert.strictEqual(race.filter((result) => result.duplicate).length, 1)

          // The database holds the same invariants without the service.
          const insertRow = (values: {
            readonly hash: string
            readonly size: string
            readonly reference: string
          }) =>
            postgresFailure(
              () => client`
                insert into billing.imported_artifacts
                  (tenant_id, source_system, source_reference, filename, media_type, content_hash,
                   byte_size, content, imported_by)
                values (${tenantId}, 'legacy_erp', ${values.reference}, 'a.pdf', 'application/pdf',
                  ${values.hash}, ${values.size}::int, decode('255044462d', 'hex'), 'sql')
              `,
            )

          const wrongHash = yield* insertRow({
            hash: sha256(pdf("other")),
            size: "5",
            reference: "sql-hash",
          })

          const wrongSize = yield* insertRow({
            hash: sha256(Buffer.from("255044462d", "hex")),
            size: "6",
            reference: "sql-size",
          })

          assert.strictEqual(postgresConstraint(wrongHash), "imported_artifacts_hash_check")
          assert.strictEqual(postgresConstraint(wrongSize), "imported_artifacts_size_check")

          const tooLarge = yield* postgresFailure(
            () => client`
              insert into billing.imported_artifacts
                (tenant_id, source_system, source_reference, filename, media_type, content_hash,
                 byte_size, content, imported_by)
              select ${tenantId}, 'legacy_erp', 'sql-large', 'a.pdf', 'application/pdf',
                encode(sha256(c), 'hex'), octet_length(c), c, 'sql'
              from (select decode(repeat('ab', ${MaxImportedArtifactBytes + 1}::int), 'hex') as c) as s
            `,
          )

          assert.strictEqual(postgresConstraint(tooLarge), "imported_artifacts_size_check")

          // Retained bytes are evidence: neither the bytes nor any other field can change or go.
          const rewrite = yield* postgresFailure(
            () => client`
              update billing.imported_artifacts set filename = 'other.pdf'
              where id = ${first.artifact.id}
            `,
          )

          const rewriteBytes = yield* postgresFailure(
            () => client`
              update billing.imported_artifacts
              set content = decode('255044462d', 'hex'), content_hash = ${sha256(Buffer.from("255044462d", "hex"))}, byte_size = 5
              where id = ${first.artifact.id}
            `,
          )

          const remove = yield* postgresFailure(
            () => client`delete from billing.imported_artifacts where id = ${first.artifact.id}`,
          )

          assert.strictEqual(postgresConstraint(rewrite), "billing_imported_artifact_immutable")
          assert.strictEqual(
            postgresConstraint(rewriteBytes),
            "billing_imported_artifact_immutable",
          )
          assert.strictEqual(postgresConstraint(remove), "billing_imported_artifact_immutable")

          const stored = yield* billing.getImportedArtifact({
            principal: reader,
            tenantId,
            artifactId: first.artifact.id,
          })

          assert.deepStrictEqual(stored.content, bytes)
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 180_000 },
)
