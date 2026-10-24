import { and, asc, eq, inArray, sum } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  purchaseOrderLines,
  purchaseOrderLineTerms,
  purchaseOrders,
  purchaseReceiptLines,
  purchaseReceipts,
  purchaseReturnLines,
  purchaseReturns,
  supplierAccounts,
  supplierPrices,
} from "../../../../db/schema/procurement.ts"
import {
  Database,
  formatSignedMinor,
  isDatabaseConstraint,
  requireExactMajorToMinor,
  uuidv7,
} from "../../../../framework/foundation/mod.ts"
import { ApprovalService } from "../../../../framework/modules/approvals/mod.ts"
import type { Principal as PrincipalSchema } from "../../../../framework/modules/auth/mod.ts"
import {
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { NumberingService } from "../../../../framework/modules/numbering/mod.ts"
import { StockKeepingService } from "../../inventory/mod.ts"
import { PartyService } from "../../party/mod.ts"
import { ProductNotFound, ProductService } from "../../product/mod.ts"
import { TaxService } from "../../tax/mod.ts"
import { ProcurementCapabilities } from "./capabilities.ts"
import { ProcurementService } from "./contract.ts"
import {
  DraftPurchaseOrderInput,
  PurchaseApprovalSubject,
  PurchaseDocumentService,
  type PurchaseMatching,
  PurchaseOrderQueryInput,
  ReceiveValuedInput,
  ReleasePurchaseOrderInput,
  ReturnToSupplierInput,
  ListSupplierPricesInput,
  SetSupplierPriceInput,
} from "./documents-contract.ts"
import {
  PurchaseLineNotStockable,
  PurchaseOrderApprovalRequired,
  PurchaseOrderInvalidState,
  PurchaseOrderNotFound,
  PurchaseReceiptQuantityExceeded,
  PurchaseReturnExceedsReceipt,
  SupplierAccountNotFound,
  SupplierPriceNotFound,
} from "./errors.ts"

type Principal = Schema.Schema.Type<typeof PrincipalSchema>

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)
const normalize = (value: string) => major(minor(value))

export const makePurchaseDocumentService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const authorized = scopedCommand(authorization)
  const approvals = yield* ApprovalService
  const numbering = yield* NumberingService
  const party = yield* PartyService
  const products = yield* ProductService
  const tax = yield* TaxService
  const stock = yield* StockKeepingService
  const procurement = yield* ProcurementService

  const loadSupplier = (principal: Principal, tenantId: string, supplierAccountId: string) =>
    Effect.gen(function* () {
      const account = (yield* database.query(
        (db) =>
          db
            .select({ relationshipId: supplierAccounts.supplierRelationshipId })
            .from(supplierAccounts)
            .where(
              and(
                eq(supplierAccounts.tenantId, tenantId),
                eq(supplierAccounts.id, supplierAccountId),
              ),
            ),
        "procurement.supplier_account.get",
      ))[0]

      if (account === undefined) {
        return yield* Effect.fail(new SupplierAccountNotFound({ tenantId, supplierAccountId }))
      }

      const relationship = yield* party.getRelationship({
        principal,
        tenantId,
        relationshipId: account.relationshipId,
      })

      return { partyId: relationship.partyId, legalEntityId: relationship.legalEntityId }
    })

  const loadMatching = (
    principal: Principal,
    tenantId: string,
    purchaseOrderId: string,
    lock = false,
  ) =>
    Effect.gen(function* () {
      const loaded = yield* database.transaction(async (tx) => {
        const query = tx
          .select({
            id: purchaseOrders.id,
            status: purchaseOrders.status,
            supplierAccountId: purchaseOrders.supplierAccountId,
          })
          .from(purchaseOrders)
          .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, purchaseOrderId)))

        const order = (await (lock ? query.for("update") : query))[0]

        if (order === undefined) return undefined

        const lines = await tx
          .select({
            purchaseOrderLineId: purchaseOrderLines.id,
            productId: purchaseOrderLines.itemId,
            ordered: purchaseOrderLines.quantity,
            unitPrice: purchaseOrderLines.unitPrice,
            taxCodeId: purchaseOrderLineTerms.taxCodeId,
          })
          .from(purchaseOrderLines)
          .leftJoin(
            purchaseOrderLineTerms,
            and(
              eq(purchaseOrderLineTerms.tenantId, purchaseOrderLines.tenantId),
              eq(purchaseOrderLineTerms.purchaseOrderLineId, purchaseOrderLines.id),
            ),
          )
          .where(
            and(
              eq(purchaseOrderLines.tenantId, tenantId),
              eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId),
            ),
          )
          .orderBy(asc(purchaseOrderLines.id))

        const received = await tx
          .select({
            lineId: purchaseReceiptLines.purchaseOrderLineId,
            quantity: sum(purchaseReceiptLines.quantity),
          })
          .from(purchaseReceiptLines)
          .where(
            and(
              eq(purchaseReceiptLines.tenantId, tenantId),
              eq(purchaseReceiptLines.purchaseOrderId, purchaseOrderId),
            ),
          )
          .groupBy(purchaseReceiptLines.purchaseOrderLineId)

        const returned = await tx
          .select({
            lineId: purchaseReturnLines.purchaseOrderLineId,
            quantity: sum(purchaseReturnLines.quantity),
          })
          .from(purchaseReturnLines)
          .where(
            and(
              eq(purchaseReturnLines.tenantId, tenantId),
              eq(purchaseReturnLines.purchaseOrderId, purchaseOrderId),
            ),
          )
          .groupBy(purchaseReturnLines.purchaseOrderLineId)

        return { order, lines, received, returned }
      }, "procurement.matching.load")

      if (loaded === undefined) {
        return yield* Effect.fail(new PurchaseOrderNotFound({ tenantId, purchaseOrderId }))
      }

      const supplier = yield* loadSupplier(
        principal,
        tenantId,
        loaded.order.supplierAccountId,
      ).pipe(Effect.catchTag("SupplierAccountNotFound", (error) => Effect.die(error)))

      const receivedBy = new Map(loaded.received.map((row) => [row.lineId, row.quantity ?? "0"]))
      const returnedBy = new Map(loaded.returned.map((row) => [row.lineId, row.quantity ?? "0"]))

      return {
        purchaseOrderId,
        supplierAccountId: loaded.order.supplierAccountId,
        partyId: supplier.partyId,
        legalEntityId: supplier.legalEntityId,
        status: loaded.order.status,
        lines: loaded.lines.map((line) => ({
          purchaseOrderLineId: line.purchaseOrderLineId,
          productId: line.productId,
          ordered: line.ordered,
          received: receivedBy.get(line.purchaseOrderLineId) ?? "0",
          returned: returnedBy.get(line.purchaseOrderLineId) ?? "0",
          unitPrice: normalize(line.unitPrice),
          taxCodeId: line.taxCodeId ?? null,
        })),
      } satisfies PurchaseMatching
    })

  const listSupplierPrices = Effect.fn("PurchaseDocumentService.listSupplierPrices")(function* (
    input: Schema.Codec.Encoded<typeof ListSupplierPricesInput>,
  ) {
    const decoded = yield* authorized(
      ListSupplierPricesInput,
      ProcurementCapabilities.supplierPriceRead,
    )(input)

    return yield* database.query(
      (db) =>
        db
          .select({
            supplierAccountId: supplierPrices.supplierAccountId,
            productId: supplierPrices.productId,
            unitPrice: supplierPrices.unitPrice,
          })
          .from(supplierPrices)
          .where(
            and(
              eq(supplierPrices.tenantId, decoded.tenantId),
              eq(supplierPrices.supplierAccountId, decoded.supplierAccountId),
            ),
          )
          .orderBy(asc(supplierPrices.productId))
          .limit(500),
      "procurement.supplier_price.list",
    )
  })

  const setSupplierPrice = Effect.fn("PurchaseDocumentService.setSupplierPrice")(function* (
    input: Schema.Codec.Encoded<typeof SetSupplierPriceInput>,
  ) {
    const decoded = yield* authorized(
      SetSupplierPriceInput,
      ProcurementCapabilities.supplierPriceConfigure,
    )(input)

    yield* database
      .query(
        (db) =>
          db
            .insert(supplierPrices)
            .values({
              tenantId: decoded.tenantId,
              supplierAccountId: decoded.supplierAccountId,
              productId: decoded.productId,
              unitPrice: decoded.unitPrice,
            })
            .onConflictDoUpdate({
              target: [
                supplierPrices.tenantId,
                supplierPrices.supplierAccountId,
                supplierPrices.productId,
              ],
              set: { unitPrice: decoded.unitPrice, updatedAt: new Date() },
            }),
        "procurement.supplier_price.set",
      )
      .pipe(
        Effect.mapError((error) => {
          if (isDatabaseConstraint(error, "supplier_prices_supplier_account_fkey", "23503")) {
            return new SupplierAccountNotFound({
              tenantId: decoded.tenantId,
              supplierAccountId: decoded.supplierAccountId,
            })
          }

          if (isDatabaseConstraint(error, "supplier_prices_product_fkey", "23503")) {
            return new ProductNotFound({ tenantId: decoded.tenantId, productId: decoded.productId })
          }

          return error
        }),
      )

    return {
      supplierAccountId: decoded.supplierAccountId,
      productId: decoded.productId,
      unitPrice: normalize(decoded.unitPrice),
    }
  })

  const draftPurchaseOrder = Effect.fn("PurchaseDocumentService.draftPurchaseOrder")(function* (
    input: Schema.Codec.Encoded<typeof DraftPurchaseOrderInput>,
  ) {
    const decoded = yield* authorized(
      DraftPurchaseOrderInput,
      ProcurementCapabilities.purchaseOrderCreate,
    )(input)

    const scope = { principal: decoded.principal, tenantId: decoded.tenantId }
    yield* loadSupplier(decoded.principal, decoded.tenantId, decoded.supplierAccountId)
    const productIds = [...new Set(decoded.lines.map((line) => line.productId))]

    for (const productId of productIds) {
      const product = yield* products.getProduct({ ...scope, productId })

      if (product.type !== "stockable") {
        return yield* Effect.fail(
          new PurchaseLineNotStockable({ tenantId: decoded.tenantId, productId }),
        )
      }
    }

    const quoted = yield* database.query(
      (db) =>
        db
          .select({ productId: supplierPrices.productId, unitPrice: supplierPrices.unitPrice })
          .from(supplierPrices)
          .where(
            and(
              eq(supplierPrices.tenantId, decoded.tenantId),
              eq(supplierPrices.supplierAccountId, decoded.supplierAccountId),
              inArray(supplierPrices.productId, productIds),
            ),
          ),
      "procurement.supplier_price.list",
    )

    const prices = new Map(quoted.map((row) => [row.productId, normalize(row.unitPrice)]))

    const defaults = decoded.lines.some((line) => line.taxCodeId === undefined)
      ? yield* tax.determineTaxCodes({ ...scope, direction: "purchase", productIds })
      : new Map<string, string | null>()

    const lines: Array<{
      id: string
      productId: string
      quantity: string
      unitPrice: string
      taxCodeId: string | null
    }> = []

    for (const line of decoded.lines) {
      const unitPrice = line.unitPrice ?? prices.get(line.productId)

      if (unitPrice === undefined) {
        return yield* Effect.fail(
          new SupplierPriceNotFound({
            tenantId: decoded.tenantId,
            supplierAccountId: decoded.supplierAccountId,
            productId: line.productId,
          }),
        )
      }

      lines.push({
        id: uuidv7(),
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: normalize(unitPrice),
        taxCodeId:
          line.taxCodeId === undefined ? (defaults.get(line.productId) ?? null) : line.taxCodeId,
      })
    }

    const total = major(
      lines.reduce((amount, line) => amount + minor(line.unitPrice) * BigInt(line.quantity), 0n),
    )

    const purchaseOrderId = uuidv7()

    return yield* database.withTransaction(
      Effect.gen(function* () {
        yield* database.transaction(async (tx) => {
          await tx.insert(purchaseOrders).values({
            id: purchaseOrderId,
            tenantId: decoded.tenantId,
            supplierAccountId: decoded.supplierAccountId,
            total,
          })
          await tx.insert(purchaseOrderLines).values(
            lines.map((line) => ({
              id: line.id,
              tenantId: decoded.tenantId,
              purchaseOrderId,
              itemId: line.productId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
            })),
          )
          await tx.insert(purchaseOrderLineTerms).values(
            lines.map((line) => ({
              tenantId: decoded.tenantId,
              purchaseOrderId,
              purchaseOrderLineId: line.id,
              taxCodeId: line.taxCodeId,
            })),
          )
        }, "procurement.purchase_order.draft")

        const required = yield* approvals.isRequired({
          ...scope,
          subjectType: PurchaseApprovalSubject,
          amount: total,
        })

        const approval = required
          ? yield* approvals.submit({
              ...scope,
              subjectType: PurchaseApprovalSubject,
              subjectId: purchaseOrderId,
              amount: total,
              reason: "Purchase order total exceeds the approval threshold",
            })
          : null

        return { purchaseOrderId, total, approval }
      }),
      "procurement.purchase_order.draft.atomic",
    )
  })

  const releasePurchaseOrder = Effect.fn("PurchaseDocumentService.releasePurchaseOrder")(function* (
    input: Schema.Codec.Encoded<typeof ReleasePurchaseOrderInput>,
  ) {
    const decoded = yield* authorized(
      ReleasePurchaseOrderInput,
      ProcurementCapabilities.purchaseOrderConfirm,
    )(input)

    const scope = { principal: decoded.principal, tenantId: decoded.tenantId }

    const matching = yield* loadMatching(
      decoded.principal,
      decoded.tenantId,
      decoded.purchaseOrderId,
    )

    const total = major(
      matching.lines.reduce(
        (amount, line) => amount + minor(line.unitPrice) * BigInt(line.ordered),
        0n,
      ),
    )

    const required = yield* approvals.isRequired({
      ...scope,
      subjectType: PurchaseApprovalSubject,
      amount: total,
    })

    if (required) {
      const approval = yield* approvals.getForSubject({
        ...scope,
        subjectType: PurchaseApprovalSubject,
        subjectId: decoded.purchaseOrderId,
      })

      // An approval covers the amount it was granted for; a larger order needs a new approval.
      if (approval?.status !== "approved" || minor(approval.amount) < minor(total)) {
        return yield* Effect.fail(
          new PurchaseOrderApprovalRequired({
            tenantId: decoded.tenantId,
            purchaseOrderId: decoded.purchaseOrderId,
            status: approval?.status ?? "missing",
          }),
        )
      }
    }

    yield* procurement.confirmPurchaseOrder({
      ...scope,
      purchaseOrderId: decoded.purchaseOrderId,
      idempotencyKey: decoded.idempotencyKey,
    })

    return yield* loadMatching(decoded.principal, decoded.tenantId, decoded.purchaseOrderId)
  })

  const getMatching = Effect.fn("PurchaseDocumentService.getMatching")(function* (
    input: Schema.Codec.Encoded<typeof PurchaseOrderQueryInput>,
  ) {
    const decoded = yield* authorized(
      PurchaseOrderQueryInput,
      ProcurementCapabilities.purchaseOrderRead,
    )(input)

    return yield* loadMatching(decoded.principal, decoded.tenantId, decoded.purchaseOrderId)
  })

  /** Validates and records receipt evidence; the database guard also caps received quantity. */
  const recordReceipt = (
    decoded: Schema.Schema.Type<typeof ReceiveValuedInput>,
    receiptId: string,
    matching: PurchaseMatching,
  ) =>
    Effect.gen(function* () {
      if (matching.status !== "confirmed") {
        return yield* Effect.fail(
          new PurchaseOrderInvalidState({
            tenantId: decoded.tenantId,
            purchaseOrderId: decoded.purchaseOrderId,
            status: matching.status,
          }),
        )
      }

      const byLine = new Map(matching.lines.map((line) => [line.purchaseOrderLineId, line]))

      const lines: Array<{
        line: PurchaseMatching["lines"][number]
        quantity: string
        unitOfMeasure: string
      }> = []

      for (const requested of decoded.lines) {
        const line = byLine.get(requested.purchaseOrderLineId)
        const received = BigInt(line?.received ?? "0")

        if (line === undefined || received + BigInt(requested.quantity) > BigInt(line.ordered)) {
          return yield* Effect.fail(
            new PurchaseReceiptQuantityExceeded({
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
              purchaseOrderLineId: requested.purchaseOrderLineId,
              ordered: line?.ordered ?? "1",
              received: received.toString(),
              requested: requested.quantity,
            }),
          )
        }

        const product = yield* products.getProduct({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          productId: line.productId,
        })

        lines.push({ line, quantity: requested.quantity, unitOfMeasure: product.unitOfMeasure })
      }

      yield* database.transaction(async (tx) => {
        await tx.insert(purchaseReceipts).values({
          id: receiptId,
          tenantId: decoded.tenantId,
          purchaseOrderId: decoded.purchaseOrderId,
          warehouseId: decoded.warehouseId,
          idempotencyKey: `valued:${receiptId}`,
        })
        await tx.insert(purchaseReceiptLines).values(
          lines.map(({ line, quantity, unitOfMeasure }) => ({
            tenantId: decoded.tenantId,
            receiptId,
            purchaseOrderId: decoded.purchaseOrderId,
            purchaseOrderLineId: line.purchaseOrderLineId,
            itemId: line.productId,
            quantity,
            unitOfMeasure,
          })),
        )
      }, "procurement.receipt.record")
    })

  const receiveValued = Effect.fn("PurchaseDocumentService.receiveValued")(function* (
    input: Schema.Codec.Encoded<typeof ReceiveValuedInput>,
  ) {
    const decoded = yield* authorized(
      ReceiveValuedInput,
      ProcurementCapabilities.purchaseReceiptReceive,
    )(input)

    const scope = { principal: decoded.principal, tenantId: decoded.tenantId }

    return yield* database.withTransaction(
      Effect.gen(function* () {
        const receiptId = decoded.receiptId ?? uuidv7()
        const source = { type: "procurement.receipt", id: receiptId }

        const recorded = (yield* database.query(
          (db) =>
            db
              .select({ id: purchaseReceipts.id })
              .from(purchaseReceipts)
              .where(
                and(
                  eq(purchaseReceipts.tenantId, decoded.tenantId),
                  eq(purchaseReceipts.id, receiptId),
                ),
              ),
          "procurement.receipt.get",
        ))[0]

        const matching = yield* loadMatching(
          decoded.principal,
          decoded.tenantId,
          decoded.purchaseOrderId,
          true,
        )

        const byLine = new Map(matching.lines.map((line) => [line.purchaseOrderLineId, line]))

        if (recorded === undefined) yield* recordReceipt(decoded, receiptId, matching)

        // Goods enter stock at the purchase price against goods received not invoiced.
        const moved = yield* stock.receiveValued({
          ...scope,
          warehouseId: decoded.warehouseId,
          postingDate: decoded.receiptDate,
          source,
          counterRole: "goods_received_not_invoiced",
          lines: decoded.lines.map((requested) => ({
            itemId: byLine.get(requested.purchaseOrderLineId)!.productId,
            quantity: requested.quantity,
            unitCost: byLine.get(requested.purchaseOrderLineId)!.unitPrice,
          })),
        })

        const allocated = yield* numbering
          .allocate({
            tenantId: decoded.tenantId,
            scopeId: matching.legalEntityId,
            documentType: "procurement.receipt",
            documentId: receiptId,
            documentDate: decoded.receiptDate,
            prefix: "GR/",
          })
          .pipe(Effect.catchTag("SchemaError", (error) => Effect.die(error)))

        return {
          id: receiptId,
          purchaseOrderId: decoded.purchaseOrderId,
          number: allocated.number,
          stock: moved,
        }
      }),
      "procurement.receipt.valued",
    )
  })

  const returnToSupplier = Effect.fn("PurchaseDocumentService.returnToSupplier")(function* (
    input: Schema.Codec.Encoded<typeof ReturnToSupplierInput>,
  ) {
    const decoded = yield* authorized(
      ReturnToSupplierInput,
      ProcurementCapabilities.purchaseReturnCreate,
    )(input)

    const scope = { principal: decoded.principal, tenantId: decoded.tenantId }

    return yield* database.withTransaction(
      Effect.gen(function* () {
        const returnId = decoded.returnId ?? uuidv7()

        const matching = yield* loadMatching(
          decoded.principal,
          decoded.tenantId,
          decoded.purchaseOrderId,
          true,
        )

        const byLine = new Map(matching.lines.map((line) => [line.purchaseOrderLineId, line]))

        const recorded = (yield* database.query(
          (db) =>
            db
              .select({ number: purchaseReturns.number })
              .from(purchaseReturns)
              .where(
                and(
                  eq(purchaseReturns.tenantId, decoded.tenantId),
                  eq(purchaseReturns.id, returnId),
                ),
              ),
          "procurement.return.get",
        ))[0]

        let number = recorded?.number

        if (number === undefined) {
          for (const requested of decoded.lines) {
            const line = byLine.get(requested.purchaseOrderLineId)

            const available =
              line === undefined ? 0n : BigInt(line.received) - BigInt(line.returned)

            if (BigInt(requested.quantity) > available) {
              return yield* Effect.fail(
                new PurchaseReturnExceedsReceipt({
                  tenantId: decoded.tenantId,
                  purchaseOrderLineId: requested.purchaseOrderLineId,
                  available: available.toString(),
                }),
              )
            }
          }

          const allocated = yield* numbering
            .allocate({
              tenantId: decoded.tenantId,
              scopeId: matching.legalEntityId,
              documentType: "procurement.return",
              documentId: returnId,
              documentDate: decoded.returnDate,
              prefix: "RET/",
            })
            .pipe(Effect.catchTag("SchemaError", (error) => Effect.die(error)))

          number = allocated.number
          yield* database.transaction(async (tx) => {
            await tx.insert(purchaseReturns).values({
              id: returnId,
              tenantId: decoded.tenantId,
              purchaseOrderId: decoded.purchaseOrderId,
              warehouseId: decoded.warehouseId,
              number: allocated.number,
              returnDate: decoded.returnDate,
            })
            await tx.insert(purchaseReturnLines).values(
              decoded.lines.map((line) => ({
                tenantId: decoded.tenantId,
                returnId,
                purchaseOrderId: decoded.purchaseOrderId,
                purchaseOrderLineId: line.purchaseOrderLineId,
                quantity: line.quantity,
              })),
            )
          }, "procurement.return.record")
        }

        // Returned goods leave stock at the purchase price, clearing goods received not invoiced.
        const moved = yield* stock.issueValued({
          ...scope,
          warehouseId: decoded.warehouseId,
          postingDate: decoded.returnDate,
          source: { type: "procurement.return", id: returnId },
          counterRole: "goods_received_not_invoiced",
          lines: decoded.lines.map((requested) => ({
            itemId: byLine.get(requested.purchaseOrderLineId)!.productId,
            quantity: requested.quantity,
            unitCost: byLine.get(requested.purchaseOrderLineId)!.unitPrice,
          })),
        })

        return { id: returnId, purchaseOrderId: decoded.purchaseOrderId, number, stock: moved }
      }),
      "procurement.return.valued",
    )
  })

  return {
    setSupplierPrice,
    listSupplierPrices,
    draftPurchaseOrder,
    releasePurchaseOrder,
    getMatching,
    receiveValued,
    returnToSupplier,
  } satisfies PurchaseDocumentService
})

export const PurchaseDocumentsLive = Layer.effect(
  PurchaseDocumentService,
  makePurchaseDocumentService,
)
