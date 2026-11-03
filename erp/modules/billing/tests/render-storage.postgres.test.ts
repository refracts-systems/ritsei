import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  createDocumentRenderRequest,
  sha256Hex,
  uuidv7,
} from "../../../../framework/foundation/mod.ts"
import { pdfNativeRendererVersion, runMigrations } from "../../../../framework/platform/mod.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import {
  type CustomerInvoiceDocument,
  makeInvoiceDocumentAst,
  makeInvoiceDocumentSnapshot,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const databaseError = Schema.Struct({ code: Schema.String })

const failureCode = (operation: () => PromiseLike<object>) =>
  Effect.tryPromise({ try: operation, catch: (cause) => cause }).pipe(
    Effect.flip,
    Effect.flatMap(Schema.decodeUnknownEffect(databaseError)),
    Effect.map((failure) => failure.code),
  )

it.effect.skipIf(databaseUrl === undefined)(
  "enforces invoice render input and artifact integrity in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const fixture = yield* seedErpFixture(client)
        const invoiceId = uuidv7()
        const journalEntryId = uuidv7()

        yield* Effect.promise(
          () => client`
            insert into billing.invoices
              (id, tenant_id, legal_entity_id, kind, party_id, number, invoice_date,
               subtotal, tax_total, total, open_amount, journal_entry_id)
            values (${invoiceId}, ${fixture.tenantId}, ${fixture.legalEntityId}, 'customer_invoice',
              ${fixture.organizationId}, 'INV-001', '2026-11-04', 10, 1, 11, 11, ${journalEntryId})
          `,
        )

        const document: Schema.Codec.Encoded<typeof CustomerInvoiceDocument> = {
          id: invoiceId,
          tenantId: fixture.tenantId,
          legalEntityId: fixture.legalEntityId,
          kind: "customer_invoice",
          partyId: fixture.organizationId,
          number: "INV-001",
          invoiceDate: "2026-11-04",
          subtotal: "10.00",
          taxTotal: "1.00",
          total: "11.00",
          openAmount: "11.00",
          sourceType: null,
          sourceId: null,
          creditedInvoiceId: null,
          supplierReference: null,
          journalEntryId,
          lines: [
            {
              id: uuidv7(),
              productId: null,
              description: "Item",
              quantity: "1",
              unitPrice: "10.00",
              netAmount: "10.00",
              taxCodeId: null,
              taxAmount: "1.00",
              sourceLineId: null,
              matchedValue: "0.00",
            },
          ],
        }

        const snapshot = yield* makeInvoiceDocumentSnapshot(document, {
          snapshotId: uuidv7(),
          capturedAt: "2026-11-04T00:00:00.000Z",
          issuerName: "Issuer",
          customerName: "Customer",
        })

        const ast = yield* makeInvoiceDocumentAst(snapshot, { astId: uuidv7() })

        const request = yield* createDocumentRenderRequest({
          fingerprintVersion: 2,
          tenantId: fixture.tenantId,
          snapshotId: snapshot.snapshotId,
          snapshotChecksum: snapshot.checksum,
          astId: ast.astId,
          astChecksum: ast.checksum,
          templateId: "invoice-default",
          templateVersion: 1,
          documentSchemaVersion: 1,
          rendererFamily: "native-transactional",
          rendererVersion: pdfNativeRendererVersion,
          assetVersions: [],
          capabilities: [],
          astNodeCount: ast.nodes.length,
          pageCount: 1,
          assetBytes: 0,
          correlationId: "invoice-storage-test",
        })

        const insertInput = (
          invoiceNumber: string,
          snapshotJson: string,
          tenantId = fixture.tenantId,
          requestJson = JSON.stringify(request),
        ) => client`
          insert into billing.invoice_render_inputs
            (id, tenant_id, invoice_id, invoice_number, snapshot_checksum, snapshot,
             ast_id, ast_checksum, ast, render_fingerprint, render_request)
          values (${snapshot.snapshotId}, ${tenantId}, ${invoiceId}, ${invoiceNumber},
            ${snapshot.checksum}, ${snapshotJson}::jsonb, ${ast.astId}, ${ast.checksum},
            ${JSON.stringify(ast)}::jsonb, ${request.renderFingerprint}, ${requestJson}::jsonb)
        `

        const missingNumber = { ...snapshot, payload: { ...snapshot.payload, number: undefined } }
        assert.strictEqual(
          yield* failureCode(() => insertInput(document.number, JSON.stringify(missingNumber))),
          "23514",
        )

        const wrongNumber = { ...snapshot, payload: { ...snapshot.payload, number: "INV-WRONG" } }
        assert.strictEqual(
          yield* failureCode(() => insertInput("INV-WRONG", JSON.stringify(wrongNumber))),
          "23503",
        )

        const [otherTenant] = yield* Effect.promise(
          () =>
            client<
              { id: string }[]
            >`insert into auth.tenants (slug) values (${uuidv7()}) returning id`,
        )

        assert.strictEqual(
          yield* failureCode(() =>
            insertInput(
              document.number,
              JSON.stringify({ ...snapshot, tenantId: otherTenant!.id }),
              otherTenant!.id,
              JSON.stringify({ ...request, tenantId: otherTenant!.id }),
            ),
          ),
          "23503",
        )

        yield* Effect.promise(() => insertInput(document.number, JSON.stringify(snapshot)))

        const secondSnapshot = yield* makeInvoiceDocumentSnapshot(document, {
          snapshotId: uuidv7(),
          capturedAt: "2026-11-04T00:00:00.000Z",
          issuerName: "Issuer",
          customerName: "Customer",
        })

        const secondAst = yield* makeInvoiceDocumentAst(secondSnapshot, { astId: uuidv7() })

        const secondRequest = yield* createDocumentRenderRequest({
          ...request,
          snapshotId: secondSnapshot.snapshotId,
          snapshotChecksum: secondSnapshot.checksum,
          astId: secondAst.astId,
          astChecksum: secondAst.checksum,
        })

        assert.strictEqual(
          yield* failureCode(
            () => client`
            insert into billing.invoice_render_inputs
              (id, tenant_id, invoice_id, invoice_number, snapshot_checksum, snapshot,
               ast_id, ast_checksum, ast, render_fingerprint, render_request)
            values (${secondSnapshot.snapshotId}, ${fixture.tenantId}, ${invoiceId}, ${document.number},
              ${secondSnapshot.checksum}, ${JSON.stringify(secondSnapshot)}::jsonb, ${secondAst.astId},
              ${secondAst.checksum}, ${JSON.stringify(secondAst)}::jsonb,
              ${secondRequest.renderFingerprint}, ${JSON.stringify(secondRequest)}::jsonb)
          `,
          ),
          "23505",
        )

        const bytes = Buffer.from("%PDF-1.7\n")
        const contentHash = yield* sha256Hex(bytes)
        const artifactId = uuidv7()

        const insertArtifact = (id: string, snapshotId: string, hash: string) => client`
          insert into billing.invoice_artifacts
            (id, tenant_id, invoice_id, snapshot_id, ast_id, render_fingerprint, content_hash, content, page_count)
          values (${id}, ${fixture.tenantId}, ${invoiceId}, ${snapshotId}, ${ast.astId},
            ${request.renderFingerprint}, ${hash}, ${bytes}, 1)
        `

        assert.strictEqual(
          yield* failureCode(() => insertArtifact(artifactId, snapshot.snapshotId, "0".repeat(64))),
          "23514",
        )
        assert.strictEqual(
          yield* failureCode(() => insertArtifact(artifactId, uuidv7(), contentHash)),
          "23503",
        )

        assert.strictEqual(
          yield* failureCode(
            () => client`
            insert into billing.invoice_artifacts
              (id, tenant_id, invoice_id, snapshot_id, ast_id, render_fingerprint,
               content_hash, content, page_count)
            values (${artifactId}, ${otherTenant!.id}, ${invoiceId}, ${snapshot.snapshotId},
              ${ast.astId}, ${request.renderFingerprint}, ${contentHash}, ${bytes}, 1)
          `,
          ),
          "23503",
        )

        const invalidBytes = Buffer.from("NO-PDF")
        const invalidHash = yield* sha256Hex(invalidBytes)

        assert.strictEqual(
          yield* failureCode(
            () => client`
            insert into billing.invoice_artifacts
              (id, tenant_id, invoice_id, snapshot_id, ast_id, render_fingerprint,
               content_hash, content, page_count)
            values (${artifactId}, ${fixture.tenantId}, ${invoiceId}, ${snapshot.snapshotId},
              ${ast.astId}, ${request.renderFingerprint}, ${invalidHash}, ${invalidBytes}, 1)
          `,
          ),
          "23514",
        )

        yield* Effect.promise(() => insertArtifact(artifactId, snapshot.snapshotId, contentHash))
        assert.strictEqual(
          yield* failureCode(() => insertArtifact(uuidv7(), snapshot.snapshotId, contentHash)),
          "23505",
        )

        assert.strictEqual(
          yield* failureCode(
            () => client`update billing.invoice_render_inputs set invoice_number = 'changed'`,
          ),
          "55000",
        )
        assert.strictEqual(
          yield* failureCode(() => client`delete from billing.invoice_artifacts`),
          "55000",
        )
        assert.strictEqual(
          yield* failureCode(() => client`update billing.invoice_artifacts set page_count = 2`),
          "55000",
        )
        assert.strictEqual(
          yield* failureCode(() => client`delete from billing.invoice_render_inputs`),
          "55000",
        )
        assert.strictEqual(
          yield* failureCode(() => client`truncate billing.invoice_artifacts`),
          "55000",
        )
        assert.strictEqual(
          yield* failureCode(() => client`truncate billing.invoice_render_inputs cascade`),
          "55000",
        )

        const artifacts = yield* Effect.promise(
          () =>
            client<
              { count: string }[]
            >`select count(*)::text as count from billing.invoice_artifacts`,
        )

        assert.strictEqual(artifacts[0]?.count, "1")
      }),
    ),
)
