import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as TestClock from "effect/testing/TestClock"

import {
  createDocumentRenderRequest,
  Database,
  DatabaseFailure,
  DurableJobEnqueuer,
  makeDocumentRenderJobPayload,
  sha256Hex,
  uuidv7,
} from "../../../../framework/foundation/mod.ts"
import {
  makePostgresDatabase,
  pdfNativeRendererVersion,
  runMigrations,
} from "../../../../framework/platform/mod.ts"
import {
  AuthorizationDenied,
  AuthorizationService,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import { MessagingService } from "../../../../framework/modules/messaging/mod.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { partial } from "../../../../tests/support/partial.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { AccountingService } from "../../accounting/mod.ts"
import { InventoryService } from "../../inventory/mod.ts"
import {
  makeProcessJobEnqueuer,
  makeProcessService,
  ProcessDocumentJobTypes,
  ProcessJobLeaseLost,
  ProcessJobNotFound,
  ProcessService,
} from "../../process/mod.ts"
import { SalesService } from "../../sales/mod.ts"
import { makePartyService, PartyCapabilities, PartyService } from "../../party/mod.ts"
import {
  type CustomerInvoiceDocument,
  BillingCapabilities,
  BillingDocumentNotFound,
  InvoiceRenderInputConflict,
  InvoiceRenderInputInvalid,
  InvoiceRenderCompletionConflict,
  InvoiceRenderEvaluationService,
  InvoiceRenderQueueConflict,
  makeInvoiceDocumentAst,
  makeInvoiceDocumentSnapshot,
  makeInvoiceRenderEvaluationService,
  makeInvoiceRenderCompletionService,
  makeInvoiceRenderQueueEvaluationService,
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
        const lineId = uuidv7()
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
              ${customerId}, 'INV-001', '2026-11-04', 10, 1, 11, 11, ${journalEntryId})
          `,
        )

        yield* Effect.promise(
          () => client`
            insert into billing.invoice_lines
              (id, tenant_id, invoice_id, description, quantity, unit_price, net_amount, tax_amount)
            values (${lineId}, ${fixture.tenantId}, ${invoiceId}, 'Item', 1, 10, 10, 1)
          `,
        )

        const document: Schema.Codec.Encoded<typeof CustomerInvoiceDocument> = {
          id: invoiceId,
          tenantId: fixture.tenantId,
          legalEntityId: fixture.legalEntityId,
          kind: "customer_invoice",
          partyId: customerId,
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
        }

        const snapshot = yield* makeInvoiceDocumentSnapshot(document, {
          snapshotId: uuidv7(),
          capturedAt: "2026-11-04T00:00:00.000Z",
          issuerName: "Fixture Trading",
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

        const principal = { userAccountId: "render-user", sessionId: "render-session" }
        const database = makePostgresDatabase(client)
        const grant = { userAccountId: principal.userAccountId, tenantId: fixture.tenantId }

        const allowedAuth = makeAuthorizationTestLayer([
          { ...grant, capability: BillingCapabilities.customerInvoiceCreate },
          { ...grant, capability: BillingCapabilities.documentRead },
          { ...grant, capability: PartyCapabilities.partyRead },
        ])

        const partyAuthorization = yield* AuthorizationService.pipe(Effect.provide(allowedAuth))

        const partyService = yield* makePartyService.pipe(
          Effect.provide(
            Layer.merge(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, partyAuthorization),
            ),
          ),
        )

        const allowed = yield* makeInvoiceRenderEvaluationService.pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(PartyService, partyService),
              allowedAuth,
            ),
          ),
        )

        const denied = yield* makeInvoiceRenderEvaluationService.pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(PartyService, partyService),
              makeAuthorizationTestLayer([]),
            ),
          ),
        )

        const stageInput = {
          principal,
          tenantId: fixture.tenantId,
          input: { snapshot, ast, request },
        }

        assert.instanceOf(yield* Effect.flip(denied.stage(stageInput)), AuthorizationDenied)

        const noPartyReadLayer = makeAuthorizationTestLayer([
          { ...grant, capability: BillingCapabilities.customerInvoiceCreate },
        ])

        const noPartyReadAuthorization = yield* AuthorizationService.pipe(
          Effect.provide(noPartyReadLayer),
        )

        const noPartyReadParty = yield* makePartyService.pipe(
          Effect.provide(
            Layer.merge(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, noPartyReadAuthorization),
            ),
          ),
        )

        const noPartyRead = yield* makeInvoiceRenderEvaluationService.pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(PartyService, noPartyReadParty),
              noPartyReadLayer,
            ),
          ),
        )

        assert.instanceOf(yield* Effect.flip(noPartyRead.stage(stageInput)), AuthorizationDenied)

        assert.instanceOf(
          yield* Effect.flip(allowed.get({ principal, tenantId: otherTenant!.id, invoiceId })),
          AuthorizationDenied,
        )

        const otherSnapshot = yield* makeInvoiceDocumentSnapshot(
          { ...document, tenantId: otherTenant!.id },
          {
            snapshotId: uuidv7(),
            capturedAt: snapshot.capturedAt,
            issuerName: "Fixture Trading",
            customerName: "Customer",
          },
        )

        const otherAst = yield* makeInvoiceDocumentAst(otherSnapshot, { astId: uuidv7() })

        const otherRequest = yield* createDocumentRenderRequest({
          ...request,
          tenantId: otherTenant!.id,
          snapshotId: otherSnapshot.snapshotId,
          snapshotChecksum: otherSnapshot.checksum,
          astId: otherAst.astId,
          astChecksum: otherAst.checksum,
        })

        const wrongTenant = yield* Effect.flip(
          allowed.stage({
            ...stageInput,
            input: { snapshot: otherSnapshot, ast: otherAst, request: otherRequest },
          }),
        )

        assert.instanceOf(wrongTenant, InvoiceRenderInputInvalid)
        assert.strictEqual(wrongTenant.reason, "tenant")

        const missingInvoice = yield* makeInvoiceDocumentSnapshot(
          { ...document, id: uuidv7() },
          {
            snapshotId: uuidv7(),
            capturedAt: snapshot.capturedAt,
            issuerName: "Fixture Trading",
            customerName: "Customer",
          },
        )

        const missingAst = yield* makeInvoiceDocumentAst(missingInvoice, { astId: uuidv7() })

        const missingRequest = yield* createDocumentRenderRequest({
          ...request,
          snapshotId: missingInvoice.snapshotId,
          snapshotChecksum: missingInvoice.checksum,
          astId: missingAst.astId,
          astChecksum: missingAst.checksum,
        })

        const missing = yield* Effect.flip(
          allowed.stage({
            ...stageInput,
            input: { snapshot: missingInvoice, ast: missingAst, request: missingRequest },
          }),
        )

        assert.instanceOf(missing, BillingDocumentNotFound)

        const forgedSnapshot = yield* makeInvoiceDocumentSnapshot(
          { ...document, total: "12.00" },
          {
            snapshotId: uuidv7(),
            capturedAt: snapshot.capturedAt,
            issuerName: "Fixture Trading",
            customerName: "Customer",
          },
        )

        const forgedAst = yield* makeInvoiceDocumentAst(forgedSnapshot, { astId: uuidv7() })

        const forgedRequest = yield* createDocumentRenderRequest({
          ...request,
          snapshotId: forgedSnapshot.snapshotId,
          snapshotChecksum: forgedSnapshot.checksum,
          astId: forgedAst.astId,
          astChecksum: forgedAst.checksum,
        })

        const forged = yield* Effect.flip(
          allowed.stage({
            ...stageInput,
            input: { snapshot: forgedSnapshot, ast: forgedAst, request: forgedRequest },
          }),
        )

        assert.instanceOf(forged, InvoiceRenderInputConflict)
        assert.strictEqual(forged.reason, "invoice_mismatch")

        for (const [issuerName, customerName, reason] of [
          ["Forged Issuer", "Customer", "issuer_name"],
          ["Fixture Trading", "Forged Customer", "customer_name"],
        ] as const) {
          const nameSnapshot = yield* makeInvoiceDocumentSnapshot(document, {
            snapshotId: uuidv7(),
            capturedAt: snapshot.capturedAt,
            issuerName,
            customerName,
          })

          const nameAst = yield* makeInvoiceDocumentAst(nameSnapshot, { astId: uuidv7() })

          const nameRequest = yield* createDocumentRenderRequest({
            ...request,
            snapshotId: nameSnapshot.snapshotId,
            snapshotChecksum: nameSnapshot.checksum,
            astId: nameAst.astId,
            astChecksum: nameAst.checksum,
          })

          const invalidName = yield* Effect.flip(
            allowed.stage({
              ...stageInput,
              input: { snapshot: nameSnapshot, ast: nameAst, request: nameRequest },
            }),
          )

          assert.instanceOf(invalidName, InvoiceRenderInputInvalid)
          assert.strictEqual(invalidName.reason, reason)
        }

        const enqueuer = yield* makeProcessJobEnqueuer.pipe(
          Effect.provideService(Database, database),
        )

        const queue = yield* makeInvoiceRenderQueueEvaluationService.pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(InvoiceRenderEvaluationService, allowed),
              Layer.succeed(DurableJobEnqueuer, enqueuer),
            ),
          ),
        )

        const deniedQueue = yield* makeInvoiceRenderQueueEvaluationService.pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(InvoiceRenderEvaluationService, denied),
              Layer.succeed(DurableJobEnqueuer, enqueuer),
            ),
          ),
        )

        assert.instanceOf(
          yield* Effect.flip(deniedQueue.stageAndEnqueue(stageInput)),
          AuthorizationDenied,
        )

        const rolledBackQueue = yield* Effect.flip(
          database.withTransaction(
            Effect.gen(function* () {
              yield* queue.stageAndEnqueue(stageInput)

              return yield* Effect.fail("rollback staged input and job")
            }),
          ),
        )

        assert.strictEqual(rolledBackQueue, "rollback staged input and job")
        assert.isNull(yield* allowed.get({ principal, tenantId: fixture.tenantId, invoiceId }))

        const queuedCount = yield* Effect.promise(
          () => client<{ count: string }[]>`select count(*)::text as count from process.jobs`,
        )

        assert.strictEqual(queuedCount[0]?.count, "0")

        const stagedResults = yield* Effect.all(
          [allowed.stage(stageInput), allowed.stage(stageInput)],
          {
            concurrency: "unbounded",
          },
        )

        assert.deepStrictEqual(stagedResults[0], stagedResults[1])

        const staged = stagedResults[0]

        yield* Effect.promise(
          () => client`update party.parties set name = 'Updated Customer' where id = ${customerId}`,
        )

        const replay = yield* allowed.stage({
          ...stageInput,
          input: { ...stageInput.input, request: { ...request, correlationId: "replay" } },
        })

        assert.deepStrictEqual(replay, staged)

        yield* Effect.promise(
          () => client`update party.parties set name = 'Customer' where id = ${customerId}`,
        )
        assert.deepStrictEqual(
          yield* allowed.get({ principal, tenantId: fixture.tenantId, invoiceId }),
          staged,
        )

        const secondSnapshot = yield* makeInvoiceDocumentSnapshot(document, {
          snapshotId: uuidv7(),
          capturedAt: "2026-11-04T00:00:00.000Z",
          issuerName: "Fixture Trading",
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

        const conflict = yield* Effect.flip(
          allowed.stage({
            ...stageInput,
            input: { snapshot: secondSnapshot, ast: secondAst, request: secondRequest },
          }),
        )

        assert.instanceOf(conflict, InvoiceRenderInputConflict)
        assert.strictEqual(conflict.reason, "existing_input")

        const bytes = Buffer.from("%PDF-1.7\n")
        const contentHash = yield* sha256Hex(bytes)
        const artifactId = uuidv7()

        const insertArtifact = (
          id: string,
          snapshotId: string,
          hash: string,
          scope = request.fenceScope,
          generation = 1,
        ) => client`
          insert into billing.invoice_artifacts
            (id, tenant_id, invoice_id, snapshot_id, ast_id, render_fingerprint, fence_scope, lease_generation, content_hash, content, page_count)
          values (${id}, ${fixture.tenantId}, ${invoiceId}, ${snapshotId}, ${ast.astId},
            ${request.renderFingerprint}, ${scope}, ${generation}, ${hash}, ${bytes}, 1)
        `

        const getArtifact = { principal, tenantId: fixture.tenantId, invoiceId }

        assert.strictEqual(yield* allowed.getArtifact(getArtifact), null)
        assert.instanceOf(yield* Effect.flip(denied.getArtifact(getArtifact)), AuthorizationDenied)
        assert.instanceOf(
          yield* Effect.flip(allowed.getArtifact({ ...getArtifact, tenantId: otherTenant!.id })),
          AuthorizationDenied,
        )

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
               fence_scope, lease_generation, content_hash, content, page_count)
            values (${artifactId}, ${otherTenant!.id}, ${invoiceId}, ${snapshot.snapshotId},
              ${ast.astId}, ${request.renderFingerprint}, ${request.fenceScope}, 1, ${contentHash}, ${bytes}, 1)
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
               fence_scope, lease_generation, content_hash, content, page_count)
            values (${artifactId}, ${fixture.tenantId}, ${invoiceId}, ${snapshot.snapshotId},
              ${ast.astId}, ${request.renderFingerprint}, ${request.fenceScope}, 1, ${invalidHash}, ${invalidBytes}, 1)
          `,
          ),
          "23514",
        )

        assert.strictEqual(
          yield* failureCode(() =>
            insertArtifact(artifactId, snapshot.snapshotId, contentHash, " "),
          ),
          "23514",
        )
        assert.strictEqual(
          yield* failureCode(() =>
            insertArtifact(artifactId, snapshot.snapshotId, contentHash, request.fenceScope, 0),
          ),
          "23514",
        )

        const authorization = yield* AuthorizationService.pipe(
          Effect.provide(makeAuthorizationTestLayer([])),
        )

        const process = yield* TestClock.withLive(
          makeProcessService.pipe(
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
          ),
        )

        const completion = yield* makeInvoiceRenderCompletionService.pipe(
          Effect.provide(
            Layer.merge(Layer.succeed(Database, database), Layer.succeed(ProcessService, process)),
          ),
        )

        const payload = { ...(yield* makeDocumentRenderJobPayload(request)), invoiceId }

        const jobInput = {
          tenantId: fixture.tenantId,
          jobType: ProcessDocumentJobTypes.invoiceRender,
          idempotencyKey: payload.idempotencyKey,
          priority: 0,
          payload,
          correlationId: payload.correlationId,
          fenceScope: payload.fenceScope,
        }

        yield* enqueuer.enqueue({ ...jobInput, idempotencyKey: `stale:${uuidv7()}` })

        const staleJob = yield* process.claimJob({
          tenantId: fixture.tenantId,
          workerId: "worker-stale",
          jobType: ProcessDocumentJobTypes.invoiceRender,
        })

        assert.isNotNull(staleJob)

        const queuedResults = yield* Effect.all(
          [queue.stageAndEnqueue(stageInput), queue.stageAndEnqueue(stageInput)],
          { concurrency: "unbounded" },
        )

        const [queued, queuedReplay] = queuedResults

        assert.strictEqual(queuedReplay.jobId, queued.jobId)

        const job = yield* process.claimJob({
          tenantId: fixture.tenantId,
          workerId: "worker-current",
          jobType: ProcessDocumentJobTypes.invoiceRender,
        })

        assert.isNotNull(job)
        assert.strictEqual(job!.jobId, queued.jobId)

        const complete = {
          tenantId: fixture.tenantId,
          invoiceId,
          artifactId,
          workerId: "worker-current",
          jobId: job!.jobId,
          leaseToken: job!.leaseToken!,
          leaseGeneration: job!.leaseGeneration,
          content: bytes,
          pageCount: 1,
        }

        const stale = yield* Effect.flip(
          completion.complete({
            ...complete,
            workerId: "worker-stale",
            jobId: staleJob!.jobId,
            leaseToken: staleJob!.leaseToken!,
            leaseGeneration: staleJob!.leaseGeneration,
          }),
        )

        assert.instanceOf(stale, ProcessJobLeaseLost)

        assert.instanceOf(
          yield* Effect.flip(completion.complete({ ...complete, tenantId: otherTenant!.id })),
          ProcessJobNotFound,
        )

        const missingInput = yield* Effect.flip(
          completion.complete({ ...complete, invoiceId: uuidv7() }),
        )

        assert.instanceOf(missingInput, InvoiceRenderCompletionConflict)
        assert.strictEqual(missingInput.reason, "input_missing")
        assert.isNull(yield* allowed.getArtifact(getArtifact))

        const invalidOutput = yield* Effect.flip(
          completion.complete({ ...complete, content: Buffer.from("invalid") }),
        )

        assert.instanceOf(invalidOutput, InvoiceRenderCompletionConflict)
        assert.strictEqual(invalidOutput.reason, "invalid_output")

        yield* Effect.promise(
          () => client`
            update process.jobs set payload = jsonb_set(payload, '{rendererVersion}', '"forged"'::jsonb)
            where id = ${job!.jobId}
          `,
        )

        assert.instanceOf(
          yield* Effect.flip(queue.stageAndEnqueue(stageInput)),
          InvoiceRenderQueueConflict,
        )

        const wrongPayload = yield* Effect.flip(completion.complete(complete))

        assert.instanceOf(wrongPayload, InvoiceRenderCompletionConflict)
        assert.strictEqual(wrongPayload.reason, "job_mismatch")
        assert.isNull(yield* allowed.getArtifact(getArtifact))

        yield* Effect.promise(
          () =>
            client`update process.jobs set payload = ${JSON.stringify(payload)}::jsonb where id = ${job!.jobId}`,
        )

        const rolledBack = yield* Effect.flip(
          database.withTransaction(
            Effect.gen(function* () {
              yield* completion.complete(complete)

              return yield* Effect.fail("rollback after artifact insertion")
            }),
          ),
        )

        assert.strictEqual(rolledBack, "rollback after artifact insertion")
        assert.isNull(yield* allowed.getArtifact(getArtifact))

        const accepted = yield* completion.complete(complete)
        assert.strictEqual(accepted.contentHash, contentHash)
        assert.instanceOf(yield* Effect.flip(completion.complete(complete)), ProcessJobLeaseLost)

        const artifact = yield* allowed.getArtifact(getArtifact)

        assert.isNotNull(artifact)
        assert.strictEqual(artifact?.artifactId, artifactId)
        assert.strictEqual(artifact?.contentHash, contentHash)
        assert.deepStrictEqual(artifact?.content, bytes)
        assert.strictEqual(artifact?.renderFingerprint, request.renderFingerprint)

        const otherReader = yield* makeInvoiceRenderEvaluationService.pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(PartyService, partyService),
              makeAuthorizationTestLayer([
                {
                  userAccountId: principal.userAccountId,
                  tenantId: otherTenant!.id,
                  capability: BillingCapabilities.documentRead,
                },
              ]),
            ),
          ),
        )

        assert.isNull(yield* otherReader.getArtifact({ ...getArtifact, tenantId: otherTenant!.id }))

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

        const corruptInvoiceId = uuidv7()

        yield* Effect.promise(
          () => client`
          insert into billing.invoices
            (id, tenant_id, legal_entity_id, kind, party_id, number, invoice_date,
             subtotal, tax_total, total, open_amount, journal_entry_id)
          values (${corruptInvoiceId}, ${fixture.tenantId}, ${fixture.legalEntityId}, 'customer_invoice',
            ${fixture.organizationId}, 'INV-002', '2026-11-04', 10, 1, 11, 11, ${uuidv7()})
        `,
        )

        const corruptSnapshot = yield* makeInvoiceDocumentSnapshot(
          { ...document, id: corruptInvoiceId, number: "INV-002" },
          {
            snapshotId: uuidv7(),
            capturedAt: snapshot.capturedAt,
            issuerName: "Fixture Trading",
            customerName: "Customer",
          },
        )

        const corruptAst = yield* makeInvoiceDocumentAst(corruptSnapshot, { astId: uuidv7() })

        const corruptRequest = yield* createDocumentRenderRequest({
          ...request,
          snapshotId: corruptSnapshot.snapshotId,
          snapshotChecksum: corruptSnapshot.checksum,
          astId: corruptAst.astId,
          astChecksum: corruptAst.checksum,
        })

        const invalidSnapshot = {
          ...corruptSnapshot,
          payload: { ...corruptSnapshot.payload, lines: [] },
        }

        yield* Effect.promise(
          () => client`
          insert into billing.invoice_render_inputs
            (id, tenant_id, invoice_id, invoice_number, snapshot_checksum, snapshot,
             ast_id, ast_checksum, ast, render_fingerprint, render_request)
          values (${corruptSnapshot.snapshotId}, ${fixture.tenantId}, ${corruptInvoiceId}, 'INV-002',
            ${corruptSnapshot.checksum}, ${JSON.stringify(invalidSnapshot)}::jsonb,
            ${corruptAst.astId}, ${corruptAst.checksum}, ${JSON.stringify(corruptAst)}::jsonb,
            ${corruptRequest.renderFingerprint}, ${JSON.stringify(corruptRequest)}::jsonb)
        `,
        )

        const corrupt = yield* Effect.flip(
          allowed.get({ principal, tenantId: fixture.tenantId, invoiceId: corruptInvoiceId }),
        )

        assert.instanceOf(corrupt, DatabaseFailure)
        assert.strictEqual(corrupt.operation, "billing.render_input.decode")
      }),
    ),
)
