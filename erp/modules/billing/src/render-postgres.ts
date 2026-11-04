import { and, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { invoiceRenderInputs } from "../../../../db/schema/billing.ts"
import {
  Database,
  DatabaseFailure,
  isDatabaseConstraint,
} from "../../../../framework/foundation/mod.ts"
import { CustomerInvoiceDocument, makeInvoiceDocumentSnapshot } from "./document.ts"
import { makeBillingDocumentLoader } from "./document-store.ts"
import { InvoiceRenderInputConflict } from "./render-contract.ts"
import { InvoiceRenderInput, validateInvoiceRenderInput } from "./render-input.ts"
import type { InvoiceRenderStore } from "./render-store.ts"

export const makePostgresInvoiceRenderStore = Effect.gen(function* () {
  const database = yield* Database
  const loadDocument = yield* makeBillingDocumentLoader

  const find: InvoiceRenderStore["find"] = Effect.fn("BillingRenderStore.find")(
    function* (tenantId, invoiceId) {
      const [row] = yield* database.query(
        (db) =>
          db
            .select({
              snapshot: invoiceRenderInputs.snapshot,
              ast: invoiceRenderInputs.ast,
              request: invoiceRenderInputs.renderRequest,
            })
            .from(invoiceRenderInputs)
            .where(
              and(
                eq(invoiceRenderInputs.tenantId, tenantId),
                eq(invoiceRenderInputs.invoiceId, invoiceId),
              ),
            ),
        "billing.render_input.find",
      )

      if (row === undefined) return null

      const parsed = yield* Schema.decodeUnknownEffect(InvoiceRenderInput)(row).pipe(
        Effect.mapError(
          (cause) => new DatabaseFailure({ operation: "billing.render_input.decode", cause }),
        ),
      )

      return yield* validateInvoiceRenderInput(parsed).pipe(
        Effect.mapError(
          (cause) => new DatabaseFailure({ operation: "billing.render_input.decode", cause }),
        ),
      )
    },
  )

  const put: InvoiceRenderStore["put"] = Effect.fn("BillingRenderStore.put")((input) =>
    database.withTransaction(
      Effect.gen(function* () {
        const { snapshot, ast, request } = input
        const tenantId = snapshot.tenantId
        const invoiceId = snapshot.source.id

        const conflict = (reason: "invoice_mismatch" | "existing_input" | "identity_in_use") =>
          new InvoiceRenderInputConflict({ tenantId, invoiceId, reason })

        const document = yield* loadDocument(tenantId, invoiceId, true)

        const invoice = yield* Schema.decodeUnknownEffect(CustomerInvoiceDocument)(document).pipe(
          Effect.catchTag("SchemaError", () => Effect.fail(conflict("invoice_mismatch"))),
        )

        const expected = yield* makeInvoiceDocumentSnapshot(invoice, {
          snapshotId: snapshot.snapshotId,
          capturedAt: snapshot.capturedAt,
          issuerName: snapshot.payload.issuerName,
          customerName: snapshot.payload.customerName,
        })

        if (expected.checksum !== snapshot.checksum) {
          return yield* Effect.fail(conflict("invoice_mismatch"))
        }

        yield* database
          .query(
            (db) =>
              db
                .insert(invoiceRenderInputs)
                .values({
                  id: snapshot.snapshotId,
                  tenantId,
                  invoiceId,
                  invoiceNumber: snapshot.payload.number,
                  snapshotChecksum: snapshot.checksum,
                  snapshot,
                  astId: ast.astId,
                  astChecksum: ast.checksum,
                  ast,
                  renderFingerprint: request.renderFingerprint,
                  renderRequest: request,
                })
                .onConflictDoNothing(),
            "billing.render_input.insert",
          )
          .pipe(
            Effect.catchTag("DatabaseFailure", (error) =>
              Effect.fail(
                isDatabaseConstraint(error, "invoice_render_inputs_invoice_fkey", "23503")
                  ? conflict("invoice_mismatch")
                  : error,
              ),
            ),
          )

        const stored = yield* find(tenantId, invoiceId)

        if (stored === null) return yield* Effect.fail(conflict("identity_in_use"))

        if (
          stored.snapshot.snapshotId !== snapshot.snapshotId ||
          stored.ast.astId !== ast.astId ||
          stored.request.renderFingerprint !== request.renderFingerprint
        ) {
          return yield* Effect.fail(conflict("existing_input"))
        }

        return stored
      }),
      "billing.render_input.stage",
    ),
  )

  return { put, find } satisfies InvoiceRenderStore
})
