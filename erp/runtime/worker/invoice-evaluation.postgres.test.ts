import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as TestClock from "effect/testing/TestClock"
import { extractText } from "pdfnative"

import {
  createDocumentRenderRequest,
  Database,
  DatabaseFailure,
  DurableJobEnqueuer,
  makeDocumentRenderJobPayload,
  uuidv7,
} from "../../../framework/foundation/mod.ts"
import {
  makePdfNativeDocumentRenderer,
  makePostgresDatabase,
  pdfNativeRendererVersion,
  runMigrations,
} from "../../../framework/platform/mod.ts"
import {
  AuthorizationDenied,
  AuthorizationService,
  makeAuthorizationTestLayer,
} from "../../../framework/modules/authorization/mod.ts"
import { MessagingService } from "../../../framework/modules/messaging/mod.ts"
import { seedErpFixture } from "../../../tests/support/erp-fixture.ts"
import { partial } from "../../../tests/support/partial.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"
import { AccountingService } from "../../modules/accounting/mod.ts"
import {
  BillingCapabilities,
  InvoiceRenderCompletionService,
  InvoiceRenderEvaluationService,
  makeInvoiceDocumentAst,
  makeInvoiceDocumentSnapshot,
  makeInvoiceRenderCompletionService,
  makeInvoiceRenderEvaluationService,
  makeInvoiceRenderQueueEvaluationService,
} from "../../modules/billing/mod.ts"
import { InventoryService } from "../../modules/inventory/mod.ts"
import { makePartyService, PartyCapabilities, PartyService } from "../../modules/party/mod.ts"
import {
  makeProcessJobEnqueuer,
  makeProcessService,
  ProcessService,
} from "../../modules/process/mod.ts"
import { SalesService } from "../../modules/sales/mod.ts"
import {
  InvoiceEvaluationJobInvalid,
  InvoiceEvaluationRenderer,
  runInvoiceEvaluationOnce,
} from "./invoice-evaluation.ts"

const databaseUrl = process.env["DATABASE_URL"]

it.effect.skipIf(databaseUrl === undefined)(
  "renders an enqueued invoice through the evaluation worker",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      TestClock.withLive(
        Effect.gen(function* () {
          yield* runMigrations(client)
          const fixture = yield* seedErpFixture(client)
          const database = makePostgresDatabase(client)
          const principal = { userAccountId: "invoice-worker", sessionId: "evaluation" }

          const authorizationLayer = makeAuthorizationTestLayer([
            {
              userAccountId: principal.userAccountId,
              tenantId: fixture.tenantId,
              capability: BillingCapabilities.customerInvoiceCreate,
            },
            {
              userAccountId: principal.userAccountId,
              tenantId: fixture.tenantId,
              capability: BillingCapabilities.documentRead,
            },
            {
              userAccountId: principal.userAccountId,
              tenantId: fixture.tenantId,
              capability: PartyCapabilities.partyRead,
            },
          ])

          const authorization = yield* AuthorizationService.pipe(Effect.provide(authorizationLayer))

          const process = yield* makeProcessService.pipe(
            Effect.provide(
              Layer.mergeAll(
                Layer.succeed(Database, database),
                Layer.succeed(AuthorizationService, authorization),
                Layer.succeed(SalesService, partial<SalesService>()({})),
                Layer.succeed(InventoryService, partial<InventoryService>()({})),
                Layer.succeed(AccountingService, partial<AccountingService>()({})),
                Layer.succeed(MessagingService, partial<MessagingService>()({})),
              ),
            ),
          )

          const partyService = yield* makePartyService.pipe(
            Effect.provide(
              Layer.merge(
                Layer.succeed(Database, database),
                Layer.succeed(AuthorizationService, authorization),
              ),
            ),
          )

          const billing = yield* makeInvoiceRenderEvaluationService.pipe(
            Effect.provide(
              Layer.mergeAll(
                Layer.succeed(Database, database),
                Layer.succeed(PartyService, partyService),
                authorizationLayer,
              ),
            ),
          )

          const completion = yield* makeInvoiceRenderCompletionService.pipe(
            Effect.provide(
              Layer.merge(
                Layer.succeed(Database, database),
                Layer.succeed(ProcessService, process),
              ),
            ),
          )

          const enqueuer = yield* makeProcessJobEnqueuer.pipe(
            Effect.provideService(Database, database),
          )

          const queue = yield* makeInvoiceRenderQueueEvaluationService.pipe(
            Effect.provide(
              Layer.mergeAll(
                Layer.succeed(Database, database),
                Layer.succeed(InvoiceRenderEvaluationService, billing),
                Layer.succeed(DurableJobEnqueuer, enqueuer),
              ),
            ),
          )

          const invoiceId = uuidv7()
          const lineId = uuidv7()
          const journalEntryId = uuidv7()
          const customerId = uuidv7()

          yield* Effect.promise(
            () => client`
            insert into party.parties (id, tenant_id, kind, name)
            values (${customerId}, ${fixture.tenantId}, 'organization', 'Customer')
          `,
          )

          yield* Effect.promise(
            () => client`
      insert into billing.invoices
        (id, tenant_id, legal_entity_id, kind, party_id, number, invoice_date,
         subtotal, tax_total, total, open_amount, journal_entry_id)
      values (${invoiceId}, ${fixture.tenantId}, ${fixture.legalEntityId}, 'customer_invoice',
        ${customerId}, 'INV-WORKER', '2026-11-04', 10, 1, 11, 11, ${journalEntryId})
    `,
          )
          yield* Effect.promise(
            () => client`
      insert into billing.invoice_lines (id, tenant_id, invoice_id, description, quantity, unit_price, net_amount, tax_amount)
      values (${lineId}, ${fixture.tenantId}, ${invoiceId}, 'Item', 1, 10, 10, 1)
    `,
          )

          const snapshot = yield* makeInvoiceDocumentSnapshot(
            {
              id: invoiceId,
              tenantId: fixture.tenantId,
              legalEntityId: fixture.legalEntityId,
              kind: "customer_invoice",
              partyId: customerId,
              number: "INV-WORKER",
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
                  id: lineId,
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
              issuerName: "Fixture Trading",
              customerName: "Customer",
            },
          )

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
            correlationId: "worker-evaluation",
          })

          const queued = yield* queue.stageAndEnqueue({
            principal,
            tenantId: fixture.tenantId,
            input: { snapshot, ast, request },
          })

          const layers = Layer.mergeAll(
            authorizationLayer,
            Layer.succeed(ProcessService, process),
            Layer.succeed(InvoiceRenderEvaluationService, billing),
            Layer.succeed(InvoiceRenderCompletionService, completion),
            Layer.succeed(InvoiceEvaluationRenderer, makePdfNativeDocumentRenderer()),
          )

          const workerInput = {
            principal,
            tenantId: fixture.tenantId,
            workerId: "evaluation-worker",
          }

          assert.instanceOf(
            yield* Effect.flip(
              runInvoiceEvaluationOnce(workerInput).pipe(
                Effect.provide(
                  Layer.mergeAll(
                    Layer.succeed(ProcessService, process),
                    Layer.succeed(InvoiceRenderEvaluationService, billing),
                    Layer.succeed(InvoiceRenderCompletionService, completion),
                    Layer.succeed(InvoiceEvaluationRenderer, makePdfNativeDocumentRenderer()),
                    makeAuthorizationTestLayer([]),
                  ),
                ),
              ),
            ),
            AuthorizationDenied,
          )

          yield* Effect.promise(
            () => client`update process.jobs set payload = '{}'::jsonb where id = ${queued.jobId}`,
          )
          assert.instanceOf(
            yield* Effect.flip(runInvoiceEvaluationOnce(workerInput).pipe(Effect.provide(layers))),
            InvoiceEvaluationJobInvalid,
          )

          const [failed] = yield* Effect.promise(
            () => client<{ status: string; last_error: string }[]>`
      select status, last_error from process.jobs where id = ${queued.jobId}
    `,
          )

          assert.strictEqual(failed?.status, "pending")
          assert.strictEqual(failed?.last_error, "invoice_render_evaluation_failed")

          const payload = { ...(yield* makeDocumentRenderJobPayload(request)), invoiceId }
          yield* Effect.promise(
            () => client`
      update process.jobs set payload = ${JSON.stringify(payload)}::jsonb, scheduled_at = now() - interval '1 second'
      where id = ${queued.jobId}
    `,
          )

          const unavailableCompletion: InvoiceRenderCompletionService = {
            complete: () =>
              Effect.fail(
                new DatabaseFailure({ operation: "test.unavailable", cause: "connection lost" }),
              ),
          }

          const unavailableLayers = Layer.mergeAll(
            authorizationLayer,
            Layer.succeed(ProcessService, process),
            Layer.succeed(InvoiceRenderEvaluationService, billing),
            Layer.succeed(InvoiceRenderCompletionService, unavailableCompletion),
            Layer.succeed(InvoiceEvaluationRenderer, makePdfNativeDocumentRenderer()),
          )

          assert.instanceOf(
            yield* Effect.flip(
              runInvoiceEvaluationOnce(workerInput).pipe(Effect.provide(unavailableLayers)),
            ),
            DatabaseFailure,
          )
          assert.isNull(
            yield* billing.getArtifact({ principal, tenantId: fixture.tenantId, invoiceId }),
          )

          const [unresolved] = yield* Effect.promise(
            () =>
              client<
                { status: string }[]
              >`select status from process.jobs where id = ${queued.jobId}`,
          )

          assert.strictEqual(unresolved?.status, "leased")

          yield* Effect.promise(
            () =>
              client`update process.jobs set lease_until = now() - interval '1 second' where id = ${queued.jobId}`,
          )

          const uncertainCompletion: InvoiceRenderCompletionService = {
            complete: (input) =>
              completion.complete(input).pipe(
                Effect.andThen(
                  Effect.fail(
                    new DatabaseFailure({
                      operation: "test.unknown_commit",
                      cause: "connection lost",
                    }),
                  ),
                ),
              ),
          }

          const uncertainLayers = Layer.mergeAll(
            authorizationLayer,
            Layer.succeed(ProcessService, process),
            Layer.succeed(InvoiceRenderEvaluationService, billing),
            Layer.succeed(InvoiceRenderCompletionService, uncertainCompletion),
            Layer.succeed(InvoiceEvaluationRenderer, makePdfNativeDocumentRenderer()),
          )

          const workers = yield* Effect.all(
            [
              runInvoiceEvaluationOnce(workerInput),
              runInvoiceEvaluationOnce({ ...workerInput, workerId: "evaluation-worker-2" }),
            ],
            { concurrency: "unbounded" },
          ).pipe(Effect.provide(uncertainLayers))

          assert.deepStrictEqual(
            new Set(workers.map((worker) => worker.status)),
            new Set(["completed", "idle"]),
          )

          const result = workers.find((worker) => worker.status === "completed")!

          assert.strictEqual(result.status, "completed")
          assert.strictEqual(result.invoiceId, invoiceId)

          const artifact = yield* billing.getArtifact({
            principal,
            tenantId: fixture.tenantId,
            invoiceId,
          })

          assert.isNotNull(artifact)
          assert.strictEqual(Buffer.from(artifact!.content).subarray(0, 5).toString(), "%PDF-")

          const renderedText = extractText(artifact!.content)
            .map((page) => page.text)
            .join("\n")

          assert.include(renderedText, "INV-WORKER")
          assert.include(renderedText, "Customer")

          const [stored] = yield* Effect.promise(
            () => client<{ count: string; generation: string }[]>`
              select count(*)::text as count, max(lease_generation)::text as generation
              from billing.invoice_artifacts where tenant_id = ${fixture.tenantId} and invoice_id = ${invoiceId}
            `,
          )

          assert.strictEqual(stored?.count, "1")
          assert.strictEqual(stored?.generation, "3")

          assert.strictEqual(
            (yield* runInvoiceEvaluationOnce(workerInput).pipe(Effect.provide(layers))).status,
            "idle",
          )
        }),
      ),
    ),
)
