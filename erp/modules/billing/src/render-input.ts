import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  createDocumentAst,
  createDocumentRenderRequest,
  createDocumentSnapshot,
  DocumentAst,
  DocumentRenderRequest,
} from "../../../../framework/foundation/mod.ts"
import { InvoiceDocumentSnapshot, makeInvoiceDocumentAst } from "./document.ts"

export const InvoiceRenderInput = Schema.Struct({
  snapshot: InvoiceDocumentSnapshot,
  ast: DocumentAst,
  request: DocumentRenderRequest,
})

export class InvoiceRenderInputInvalid extends Schema.TaggedError<InvoiceRenderInputInvalid>()(
  "InvoiceRenderInputInvalid",
  {
    tenantId: InvoiceDocumentSnapshot.fields.tenantId,
    invoiceId: InvoiceDocumentSnapshot.fields.source.fields.id,
    reason: Schema.Literals(["snapshot", "ast", "request"]),
  },
) {}

/** Checks evaluation input before it can be persisted or handed to a renderer. */
export const validateInvoiceRenderInput = Effect.fn("Billing.validateInvoiceRenderInput")(
  function* (input: Schema.Codec.Encoded<typeof InvoiceRenderInput>) {
    const decoded = yield* Schema.decodeUnknownEffect(InvoiceRenderInput)(input)
    const { snapshot, ast, request } = decoded

    const invalid = (reason: "snapshot" | "ast" | "request") =>
      new InvoiceRenderInputInvalid({
        tenantId: snapshot.tenantId,
        invoiceId: snapshot.source.id,
        reason,
      })

    const checkedSnapshot = yield* createDocumentSnapshot({
      snapshotId: snapshot.snapshotId,
      tenantId: snapshot.tenantId,
      source: snapshot.source,
      capturedAt: snapshot.capturedAt,
      schemaVersion: snapshot.schemaVersion,
      payload: snapshot.payload,
    })

    if (snapshot.schemaVersion !== 1 || checkedSnapshot.checksum !== snapshot.checksum) {
      return yield* Effect.fail(invalid("snapshot"))
    }

    const checkedAst = yield* createDocumentAst(ast)
    const expectedAst = yield* makeInvoiceDocumentAst(snapshot, { astId: ast.astId })

    if (
      ast.snapshotId !== snapshot.snapshotId ||
      checkedAst.checksum !== ast.checksum ||
      expectedAst.checksum !== ast.checksum
    ) {
      return yield* Effect.fail(invalid("ast"))
    }

    const checkedRequest = yield* createDocumentRenderRequest(request)

    if (
      request.tenantId !== snapshot.tenantId ||
      request.snapshotId !== snapshot.snapshotId ||
      request.snapshotChecksum !== snapshot.checksum ||
      request.astId !== ast.astId ||
      request.astChecksum !== ast.checksum ||
      request.astNodeCount !== ast.nodes.length ||
      request.documentSchemaVersion !== 1 ||
      request.rendererFamily !== "native-transactional" ||
      request.renderFingerprint !== checkedRequest.renderFingerprint ||
      request.fenceScope !== checkedRequest.fenceScope
    ) {
      return yield* Effect.fail(invalid("request"))
    }

    return decoded
  },
)
