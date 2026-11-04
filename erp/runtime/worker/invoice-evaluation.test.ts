import { assert, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as TestClock from "effect/testing/TestClock"

import {
  createDocumentRenderRequest,
  type DocumentRenderer,
  makeDocumentRenderJobPayload,
  uuidv7,
} from "../../../framework/foundation/mod.ts"
import { makeAuthorizationTestLayer } from "../../../framework/modules/authorization/mod.ts"
import { partial } from "../../../tests/support/partial.ts"
import {
  BillingCapabilities,
  InvoiceRenderCompletionService,
  InvoiceRenderEvaluationService,
  makeInvoiceDocumentAst,
  makeInvoiceDocumentSnapshot,
} from "../../modules/billing/mod.ts"
import {
  ProcessDocumentJobTypes,
  ProcessJobLeaseLost,
  ProcessService,
} from "../../modules/process/mod.ts"
import { InvoiceEvaluationRenderer, runInvoiceEvaluationOnce } from "./invoice-evaluation.ts"

it.effect("renews a render lease and stops when the lease is lost", () =>
  Effect.gen(function* () {
    const tenantId = uuidv7()
    const invoiceId = uuidv7()
    const jobId = uuidv7()
    const principal = { userAccountId: "worker", sessionId: "session" }

    const snapshot = yield* makeInvoiceDocumentSnapshot(
      {
        id: invoiceId,
        tenantId,
        legalEntityId: uuidv7(),
        kind: "customer_invoice",
        partyId: uuidv7(),
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
        journalEntryId: uuidv7(),
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
      },
      {
        snapshotId: uuidv7(),
        capturedAt: "2026-11-04T00:00:00.000Z",
        issuerName: "Issuer",
        customerName: "Customer",
      },
    )

    const ast = yield* makeInvoiceDocumentAst(snapshot, { astId: uuidv7() })

    const request = yield* createDocumentRenderRequest({
      fingerprintVersion: 2,
      tenantId,
      snapshotId: snapshot.snapshotId,
      snapshotChecksum: snapshot.checksum,
      astId: ast.astId,
      astChecksum: ast.checksum,
      templateId: "invoice-default",
      templateVersion: 1,
      documentSchemaVersion: 1,
      rendererFamily: "native-transactional",
      rendererVersion: "test@1",
      assetVersions: [],
      capabilities: [],
      astNodeCount: ast.nodes.length,
      pageCount: 1,
      assetBytes: 0,
      correlationId: "heartbeat-test",
    })

    const payload = { ...(yield* makeDocumentRenderJobPayload(request)), invoiceId }

    const job = {
      jobId,
      tenantId,
      fenceScope: payload.fenceScope,
      leaseGeneration: "2",
      jobType: ProcessDocumentJobTypes.invoiceRender,
      idempotencyKey: payload.idempotencyKey,
      priority: 0,
      status: "leased" as const,
      scheduledAt: "2026-11-04T00:00:00.000Z",
      leaseUntil: "2026-11-04T00:05:00.000Z",
      leaseOwner: "worker",
      leaseToken: uuidv7(),
      attempts: 1,
      payload,
      correlationId: payload.correlationId,
    }

    let renewals = 0

    const process = partial<ProcessService>()({
      claimJob: () => Effect.succeed(job),
      renewJob: (input: { leaseGeneration: string }) =>
        Effect.suspend(() => {
          assert.strictEqual(input.leaseGeneration, "2")
          renewals += 1

          return renewals === 1
            ? Effect.succeed(job)
            : Effect.fail(new ProcessJobLeaseLost({ tenantId, jobId }))
        }),
      failJob: () => Effect.die("lost leases must not be failed"),
    })

    const billing = partial<InvoiceRenderEvaluationService>()({
      get: () => Effect.succeed({ snapshot, ast, request }),
    })

    const completion = partial<InvoiceRenderCompletionService>()({
      complete: () => Effect.die("stale worker must not publish"),
    })

    const started = yield* Deferred.make<void>()

    const renderer = partial<DocumentRenderer>()({
      family: "native-transactional",
      render: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    })

    const fiber = yield* runInvoiceEvaluationOnce({ principal, tenantId, workerId: "worker" }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeAuthorizationTestLayer([
            {
              userAccountId: principal.userAccountId,
              tenantId,
              capability: BillingCapabilities.documentRead,
            },
          ]),
          Layer.succeed(ProcessService, process),
          Layer.succeed(InvoiceRenderEvaluationService, billing),
          Layer.succeed(InvoiceRenderCompletionService, completion),
          Layer.succeed(InvoiceEvaluationRenderer, renderer),
        ),
      ),
      Effect.forkChild,
    )

    yield* Deferred.await(started)
    yield* TestClock.adjust("1 minute")
    assert.strictEqual(renewals, 1)
    yield* TestClock.adjust("1 minute")
    assert.instanceOf(yield* Effect.flip(Fiber.join(fiber)), ProcessJobLeaseLost)
    assert.strictEqual(renewals, 2)
  }),
)
