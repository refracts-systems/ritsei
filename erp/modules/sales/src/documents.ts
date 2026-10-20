import { and, asc, eq, inArray, lt, sum } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import {
  customers,
  deliveries,
  deliveryLines,
  orderLines,
  orderLineTerms,
  orders,
  priceListItems,
  priceLists,
  quotationLines,
  quotations,
} from "../../../../db/schema/sales.ts"
import {
  Database,
  formatSignedMinor,
  isDatabaseConstraint,
  requireExactMajorToMinor,
  uuidv7,
} from "../../../../framework/foundation/mod.ts"
import {
  AuthorizationService,
  makeScopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { NumberingService } from "../../../../framework/modules/numbering/mod.ts"
import { PartyService } from "../../party/mod.ts"
import { TaxService } from "../../tax/mod.ts"
import { SalesCapabilities } from "./capabilities.ts"
import {
  AssignCustomerPriceListInput,
  CreatePartyCustomerInput,
  CreatePriceListInput,
  type Delivery,
  DraftQuotationInput,
  ExpireQuotationsInput,
  type OrderFulfillment,
  OrderQueryInput,
  type PartyCustomer,
  QuotationCommandInput,
  RecordDeliveryInput,
  SalesDocumentService,
  type SalesQuotation,
  SetPriceInput,
} from "./documents-contract.ts"
import {
  CustomerAlreadyExists,
  CustomerLegalEntityRequired,
  CustomerNotFound,
  CustomerPartyRoleInvalid,
  DeliveryExceedsOrder,
  OrderLineNotFound,
  PriceListAlreadyExists,
  PriceListNotFound,
  ProductPriceNotFound,
  QuotationInvalidState,
  QuotationNotFound,
  SalesOrderInvalidState,
  SalesOrderNotFound,
} from "./errors.ts"

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)
const normalizeMoney = (value: string) => major(minor(value))

/** Discount `12.5` percent → 1250 basis points. */
const basisPoints = (percent: string) => {
  const [whole = "0", fraction = ""] = percent.split(".")
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2))
}
const formatPercent = (points: bigint) =>
  `${points / 100n}.${(points % 100n).toString().padStart(2, "0")}`

/** Net unit price after a discount, rounded half up to the cent. */
export const discountedPrice = (listPrice: string, discountPercent: string) => {
  const numerator = minor(listPrice) * (10_000n - basisPoints(discountPercent))
  return major((numerator * 2n + 10_000n) / 20_000n)
}

const customerSelection = {
  id: customers.id,
  tenantId: customers.tenantId,
  name: customers.name,
  email: customers.email,
  partyId: customers.partyId,
  partyRelationshipId: customers.partyRelationshipId,
  legalEntityId: customers.legalEntityId,
  priceListId: customers.priceListId,
}

const toPartyCustomer = (row: {
  id: string
  tenantId: string
  name: string
  email: string
  partyId: string | null
  partyRelationshipId: string | null
  legalEntityId: string | null
  priceListId: string | null
}): PartyCustomer | undefined =>
  row.partyId === null || row.partyRelationshipId === null || row.legalEntityId === null
    ? undefined
    : {
        ...row,
        partyId: row.partyId,
        partyRelationshipId: row.partyRelationshipId,
        legalEntityId: row.legalEntityId,
      }

export const makeSalesDocumentService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const authorized = makeScopedCommand(authorization)
  const party = yield* PartyService
  const tax = yield* TaxService
  const numbering = yield* NumberingService

  const loadCustomer = (tenantId: string, customerId: string) =>
    Effect.gen(function* () {
      const row = (yield* database.query(
        (db) =>
          db
            .select(customerSelection)
            .from(customers)
            .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId))),
        "sales.customer.get",
      ))[0]
      if (row === undefined)
        return yield* Effect.fail(new CustomerNotFound({ tenantId, customerId }))
      const customer = toPartyCustomer(row)
      if (customer === undefined) {
        return yield* Effect.fail(new CustomerLegalEntityRequired({ tenantId, customerId }))
      }
      return customer
    })

  const loadQuotation = (tenantId: string, quotationId: string, lock: boolean) =>
    Effect.gen(function* () {
      const loaded = yield* database.transaction(async (tx) => {
        const query = tx
          .select()
          .from(quotations)
          .where(and(eq(quotations.tenantId, tenantId), eq(quotations.id, quotationId)))
        const header = (await (lock ? query.for("update") : query))[0]
        if (header === undefined) return undefined
        const lines = await tx
          .select()
          .from(quotationLines)
          .where(
            and(eq(quotationLines.tenantId, tenantId), eq(quotationLines.quotationId, quotationId)),
          )
          .orderBy(asc(quotationLines.id))
        return { header, lines }
      }, "sales.quotation.load")
      // Quotations created before priced lines carry no legal entity or validity.
      if (
        loaded === undefined ||
        loaded.header.legalEntityId === null ||
        loaded.header.validUntil === null
      ) {
        return yield* Effect.fail(new QuotationNotFound({ tenantId, quotationId }))
      }
      const { header, lines } = loaded
      return {
        id: header.id,
        tenantId: header.tenantId,
        customerId: header.customerId,
        legalEntityId: header.legalEntityId!,
        status: header.status,
        validUntil: header.validUntil!,
        total: normalizeMoney(header.total),
        lines: lines.map((line) => ({
          id: line.id,
          productId: line.productId,
          quantity: line.quantity,
          listPrice: normalizeMoney(line.listPrice),
          discountPercent: formatPercent(basisPoints(line.discountPercent)),
          unitPrice: normalizeMoney(line.unitPrice),
          taxCodeId: line.taxCodeId,
          lineTotal: major(minor(line.unitPrice) * BigInt(line.quantity)),
        })),
      } satisfies SalesQuotation
    })

  const transition = (
    input: unknown,
    capability: string,
    from: SalesQuotation["status"],
    to: "sent" | "accepted" | "rejected",
  ) =>
    Effect.gen(function* () {
      const decoded = yield* authorized(QuotationCommandInput, capability)(input)
      return yield* database.withTransaction(
        Effect.gen(function* () {
          const quotation = yield* loadQuotation(decoded.tenantId, decoded.quotationId, true)
          if (quotation.status === to) return quotation
          if (quotation.status !== from) {
            return yield* Effect.fail(
              new QuotationInvalidState({
                tenantId: decoded.tenantId,
                quotationId: decoded.quotationId,
                status: quotation.status,
              }),
            )
          }
          const now = new Date()
          yield* database.query(
            (db) =>
              db
                .update(quotations)
                .set(
                  to === "sent"
                    ? { status: to, sentAt: now, updatedAt: now }
                    : { status: to, decidedAt: now, updatedAt: now },
                )
                .where(
                  and(
                    eq(quotations.tenantId, decoded.tenantId),
                    eq(quotations.id, decoded.quotationId),
                  ),
                ),
            "sales.quotation.transition",
          )
          return { ...quotation, status: to }
        }),
        "sales.quotation.transition.atomic",
      )
    })

  const createPartyCustomer = Effect.fn("SalesDocumentService.createPartyCustomer")(function* (
    input: unknown,
  ) {
    const decoded = yield* authorized(
      CreatePartyCustomerInput,
      SalesCapabilities.customerCreate,
    )(input)
    const relationship = yield* party.getRelationship({
      principal: decoded.principal,
      tenantId: decoded.tenantId,
      relationshipId: decoded.partyRelationshipId,
    })
    if (relationship.kind !== "customer" || !relationship.active) {
      return yield* Effect.fail(
        new CustomerPartyRoleInvalid({
          tenantId: decoded.tenantId,
          partyRelationshipId: decoded.partyRelationshipId,
        }),
      )
    }
    const existing = (yield* database.query(
      (db) =>
        db
          .select(customerSelection)
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, decoded.tenantId),
              eq(customers.partyRelationshipId, decoded.partyRelationshipId),
            ),
          ),
      "sales.customer.by_relationship",
    ))[0]
    if (existing !== undefined) return toPartyCustomer(existing)!
    const detail = yield* party.getDetail({
      principal: decoded.principal,
      tenantId: decoded.tenantId,
      partyId: relationship.partyId,
    })
    const email = decoded.email.trim().toLowerCase()
    const rows = yield* database
      .query(
        (db) =>
          db
            .insert(customers)
            .values({
              tenantId: decoded.tenantId,
              name: detail.party.name,
              email,
              partyId: relationship.partyId,
              partyRelationshipId: relationship.id,
              legalEntityId: relationship.legalEntityId,
            })
            .returning(customerSelection),
        "sales.customer.create_from_party",
      )
      .pipe(
        Effect.mapError((error) =>
          isDatabaseConstraint(error, "customers_tenant_email_key")
            ? new CustomerAlreadyExists({ tenantId: decoded.tenantId, email })
            : error,
        ),
      )
    return toPartyCustomer(rows[0]!)!
  })

  const createPriceList = Effect.fn("SalesDocumentService.createPriceList")(function* (
    input: unknown,
  ) {
    const decoded = yield* authorized(
      CreatePriceListInput,
      SalesCapabilities.priceListConfigure,
    )(input)
    const rows = yield* database
      .query(
        (db) =>
          db
            .insert(priceLists)
            .values({ tenantId: decoded.tenantId, name: decoded.name, currency: decoded.currency })
            .returning({
              id: priceLists.id,
              tenantId: priceLists.tenantId,
              name: priceLists.name,
              currency: priceLists.currency,
            }),
        "sales.price_list.create",
      )
      .pipe(
        Effect.mapError((error) =>
          isDatabaseConstraint(error, "price_lists_tenant_name_key")
            ? new PriceListAlreadyExists({ tenantId: decoded.tenantId, name: decoded.name })
            : error,
        ),
      )
    return rows[0]!
  })

  const setPrice = Effect.fn("SalesDocumentService.setPrice")(function* (input: unknown) {
    const decoded = yield* authorized(SetPriceInput, SalesCapabilities.priceListConfigure)(input)
    yield* database
      .query(
        (db) =>
          db
            .insert(priceListItems)
            .values({
              tenantId: decoded.tenantId,
              priceListId: decoded.priceListId,
              productId: decoded.productId,
              unitPrice: decoded.unitPrice,
            })
            .onConflictDoUpdate({
              target: [
                priceListItems.tenantId,
                priceListItems.priceListId,
                priceListItems.productId,
              ],
              set: { unitPrice: decoded.unitPrice, updatedAt: new Date() },
            }),
        "sales.price_list.set_price",
      )
      .pipe(
        Effect.mapError((error) => {
          if (isDatabaseConstraint(error, "price_list_items_price_list_fkey", "23503")) {
            return new PriceListNotFound({
              tenantId: decoded.tenantId,
              priceListId: decoded.priceListId,
            })
          }
          if (isDatabaseConstraint(error, "price_list_items_product_fkey", "23503")) {
            return new ProductPriceNotFound({
              tenantId: decoded.tenantId,
              productId: decoded.productId,
            })
          }
          return error
        }),
      )
    return {
      priceListId: decoded.priceListId,
      productId: decoded.productId,
      unitPrice: normalizeMoney(decoded.unitPrice),
    }
  })

  const assignCustomerPriceList = Effect.fn("SalesDocumentService.assignCustomerPriceList")(
    function* (input: unknown) {
      const decoded = yield* authorized(
        AssignCustomerPriceListInput,
        SalesCapabilities.priceListConfigure,
      )(input)
      const list = yield* database.query(
        (db) =>
          db
            .select({ id: priceLists.id })
            .from(priceLists)
            .where(
              and(
                eq(priceLists.tenantId, decoded.tenantId),
                eq(priceLists.id, decoded.priceListId),
              ),
            ),
        "sales.price_list.get",
      )
      if (list[0] === undefined) {
        return yield* Effect.fail(
          new PriceListNotFound({ tenantId: decoded.tenantId, priceListId: decoded.priceListId }),
        )
      }
      const customer = yield* loadCustomer(decoded.tenantId, decoded.customerId).pipe(
        Effect.catchTag("CustomerLegalEntityRequired", () =>
          Effect.fail(
            new CustomerNotFound({ tenantId: decoded.tenantId, customerId: decoded.customerId }),
          ),
        ),
      )
      yield* database.query(
        (db) =>
          db
            .update(customers)
            .set({ priceListId: decoded.priceListId, updatedAt: new Date() })
            .where(and(eq(customers.tenantId, decoded.tenantId), eq(customers.id, customer.id))),
        "sales.customer.assign_price_list",
      )
      return { ...customer, priceListId: decoded.priceListId }
    },
  )

  const draftQuotation = Effect.fn("SalesDocumentService.draftQuotation")(function* (
    input: unknown,
  ) {
    const decoded = yield* authorized(DraftQuotationInput, SalesCapabilities.quotationCreate)(input)
    const customer = yield* loadCustomer(decoded.tenantId, decoded.customerId)
    const productIds = [...new Set(decoded.lines.map((line) => line.productId))]
    const listed =
      customer.priceListId === null
        ? []
        : yield* database.query(
            (db) =>
              db
                .select({
                  productId: priceListItems.productId,
                  unitPrice: priceListItems.unitPrice,
                })
                .from(priceListItems)
                .where(
                  and(
                    eq(priceListItems.tenantId, decoded.tenantId),
                    eq(priceListItems.priceListId, customer.priceListId!),
                    inArray(priceListItems.productId, productIds),
                  ),
                ),
            "sales.price_list.prices",
          )
    const prices = new Map(listed.map((row) => [row.productId, normalizeMoney(row.unitPrice)]))
    const defaults = decoded.lines.some((line) => line.taxCodeId === undefined)
      ? yield* tax.determineTaxCodes({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          direction: "sales",
          productIds,
        })
      : new Map<string, string | null>()
    const lines = []
    for (const line of decoded.lines) {
      const listPrice = line.listPrice ?? prices.get(line.productId)
      if (listPrice === undefined) {
        return yield* Effect.fail(
          new ProductPriceNotFound({ tenantId: decoded.tenantId, productId: line.productId }),
        )
      }
      const discountPercent = line.discountPercent ?? "0"
      lines.push({
        id: uuidv7(),
        productId: line.productId,
        quantity: line.quantity,
        listPrice: normalizeMoney(listPrice),
        discountPercent: formatPercent(basisPoints(discountPercent)),
        unitPrice: discountedPrice(listPrice, discountPercent),
        taxCodeId:
          line.taxCodeId === undefined ? (defaults.get(line.productId) ?? null) : line.taxCodeId,
      })
    }
    const priced = lines.map((line) => ({
      ...line,
      lineTotal: major(minor(line.unitPrice) * BigInt(line.quantity)),
    }))
    const total = major(priced.reduce((sum, line) => sum + minor(line.lineTotal), 0n))
    const quotationId = uuidv7()
    yield* database.transaction(async (tx) => {
      await tx.insert(quotations).values({
        id: quotationId,
        tenantId: decoded.tenantId,
        customerId: customer.id,
        total,
        legalEntityId: customer.legalEntityId,
        validUntil: decoded.validUntil,
      })
      await tx.insert(quotationLines).values(
        priced.map((line) => ({
          id: line.id,
          tenantId: decoded.tenantId,
          quotationId,
          productId: line.productId,
          quantity: line.quantity,
          listPrice: line.listPrice,
          discountPercent: line.discountPercent,
          unitPrice: line.unitPrice,
          taxCodeId: line.taxCodeId,
        })),
      )
    }, "sales.quotation.draft")
    return {
      id: quotationId,
      tenantId: decoded.tenantId,
      customerId: customer.id,
      legalEntityId: customer.legalEntityId,
      status: "draft" as const,
      validUntil: decoded.validUntil,
      total,
      lines: priced,
    }
  })

  const getQuotation = Effect.fn("SalesDocumentService.getQuotation")(function* (input: unknown) {
    const decoded = yield* authorized(QuotationCommandInput, SalesCapabilities.quotationRead)(input)
    return yield* loadQuotation(decoded.tenantId, decoded.quotationId, false)
  })

  const expireQuotations = Effect.fn("SalesDocumentService.expireQuotations")(function* (
    input: unknown,
  ) {
    const decoded = yield* authorized(
      ExpireQuotationsInput,
      SalesCapabilities.quotationDecide,
    )(input)
    const now = new Date()
    const rows = yield* database.query(
      (db) =>
        db
          .update(quotations)
          .set({ status: "expired", decidedAt: now, updatedAt: now })
          .where(
            and(
              eq(quotations.tenantId, decoded.tenantId),
              eq(quotations.status, "sent"),
              lt(quotations.validUntil, decoded.asOf),
            ),
          )
          .returning({ id: quotations.id }),
      "sales.quotation.expire",
    )
    return rows.map((row) => row.id).toSorted()
  })

  const convertQuotation = Effect.fn("SalesDocumentService.convertQuotation")(function* (
    input: unknown,
  ) {
    const decoded = yield* authorized(QuotationCommandInput, SalesCapabilities.orderCreate)(input)
    return yield* database.withTransaction(
      Effect.gen(function* () {
        const quotation = yield* loadQuotation(decoded.tenantId, decoded.quotationId, true)
        const existing = yield* database.query(
          (db) =>
            db
              .select({ id: orders.id })
              .from(orders)
              .where(
                and(eq(orders.tenantId, decoded.tenantId), eq(orders.quotationId, quotation.id)),
              ),
          "sales.order.by_quotation",
        )
        if (existing[0] !== undefined) return { orderId: existing[0].id }
        if (quotation.status !== "accepted") {
          return yield* Effect.fail(
            new QuotationInvalidState({
              tenantId: decoded.tenantId,
              quotationId: quotation.id,
              status: quotation.status,
            }),
          )
        }
        const orderId = uuidv7()
        yield* database.transaction(async (tx) => {
          await tx.insert(orders).values({
            id: orderId,
            tenantId: decoded.tenantId,
            customerId: quotation.customerId,
            quotationId: quotation.id,
            total: quotation.total,
            legalEntityId: quotation.legalEntityId,
          })
          const lines = quotation.lines.map((line) => ({ ...line, orderLineId: uuidv7() }))
          await tx.insert(orderLines).values(
            lines.map((line) => ({
              id: line.orderLineId,
              tenantId: decoded.tenantId,
              orderId,
              itemId: line.productId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
            })),
          )
          await tx.insert(orderLineTerms).values(
            lines.map((line) => ({
              tenantId: decoded.tenantId,
              orderLineId: line.orderLineId,
              listPrice: line.listPrice,
              discountPercent: line.discountPercent,
              taxCodeId: line.taxCodeId,
            })),
          )
        }, "sales.order.from_quotation")
        return { orderId }
      }),
      "sales.quotation.convert",
    )
  })

  const loadFulfillment = (tenantId: string, orderId: string, lock: boolean) =>
    Effect.gen(function* () {
      const loaded = yield* database.transaction(async (tx) => {
        const query = tx
          .select({
            id: orders.id,
            status: orders.status,
            customerId: orders.customerId,
            legalEntityId: orders.legalEntityId,
          })
          .from(orders)
          .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
        const order = (await (lock ? query.for("update") : query))[0]
        if (order === undefined) return undefined
        const customer = (
          await tx
            .select({ partyId: customers.partyId, legalEntityId: customers.legalEntityId })
            .from(customers)
            .where(and(eq(customers.tenantId, tenantId), eq(customers.id, order.customerId)))
        )[0]
        const lines = await tx
          .select({
            orderLineId: orderLines.id,
            productId: orderLines.itemId,
            quantity: orderLines.quantity,
            unitPrice: orderLines.unitPrice,
            taxCodeId: orderLineTerms.taxCodeId,
          })
          .from(orderLines)
          .leftJoin(
            orderLineTerms,
            and(
              eq(orderLineTerms.tenantId, orderLines.tenantId),
              eq(orderLineTerms.orderLineId, orderLines.id),
            ),
          )
          .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, orderId)))
          .orderBy(asc(orderLines.id))
        const delivered = await tx
          .select({ orderLineId: deliveryLines.orderLineId, quantity: sum(deliveryLines.quantity) })
          .from(deliveryLines)
          .where(and(eq(deliveryLines.tenantId, tenantId), eq(deliveryLines.orderId, orderId)))
          .groupBy(deliveryLines.orderLineId)
        return { order, customer, lines, delivered }
      }, "sales.order.fulfillment")
      if (loaded === undefined) {
        return yield* Effect.fail(new SalesOrderNotFound({ tenantId, orderId }))
      }
      const legalEntityId = loaded.order.legalEntityId ?? loaded.customer?.legalEntityId ?? null
      const partyId = loaded.customer?.partyId ?? null
      if (legalEntityId === null || partyId === null) {
        return yield* Effect.fail(
          new CustomerLegalEntityRequired({ tenantId, customerId: loaded.order.customerId }),
        )
      }
      const deliveredByLine = new Map(
        loaded.delivered.map((row) => [row.orderLineId, row.quantity ?? "0"]),
      )
      return {
        orderId: loaded.order.id,
        tenantId,
        legalEntityId,
        customerId: loaded.order.customerId,
        partyId,
        status: loaded.order.status,
        lines: loaded.lines.map((line) => ({
          orderLineId: line.orderLineId,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: normalizeMoney(line.unitPrice),
          taxCodeId: line.taxCodeId ?? null,
          delivered: deliveredByLine.get(line.orderLineId) ?? "0",
        })),
      } satisfies OrderFulfillment
    })

  const getFulfillment = Effect.fn("SalesDocumentService.getFulfillment")(function* (
    input: unknown,
  ) {
    const decoded = yield* authorized(OrderQueryInput, SalesCapabilities.orderRead)(input)
    return yield* loadFulfillment(decoded.tenantId, decoded.orderId, false)
  })

  const loadDelivery = (tenantId: string, deliveryId: string) =>
    database.transaction(async (tx) => {
      const header = (
        await tx
          .select()
          .from(deliveries)
          .where(and(eq(deliveries.tenantId, tenantId), eq(deliveries.id, deliveryId)))
      )[0]
      if (header === undefined) return undefined
      const lines = await tx
        .select({
          orderLineId: deliveryLines.orderLineId,
          productId: orderLines.itemId,
          quantity: deliveryLines.quantity,
        })
        .from(deliveryLines)
        .innerJoin(
          orderLines,
          and(
            eq(orderLines.tenantId, deliveryLines.tenantId),
            eq(orderLines.id, deliveryLines.orderLineId),
          ),
        )
        .where(and(eq(deliveryLines.tenantId, tenantId), eq(deliveryLines.deliveryId, deliveryId)))
        .orderBy(asc(deliveryLines.id))
      return {
        id: header.id,
        tenantId: header.tenantId,
        number: header.number,
        orderId: header.orderId,
        legalEntityId: header.legalEntityId,
        warehouseId: header.warehouseId,
        deliveryDate: header.deliveryDate,
        lines,
      } satisfies Delivery
    }, "sales.delivery.load")

  const recordDelivery = Effect.fn("SalesDocumentService.recordDelivery")(function* (
    input: unknown,
  ) {
    const decoded = yield* authorized(RecordDeliveryInput, SalesCapabilities.deliveryRecord)(input)
    return yield* database.withTransaction(
      Effect.gen(function* () {
        // Locking the order serializes deliveries, so the cumulative guard holds.
        const fulfillment = yield* loadFulfillment(decoded.tenantId, decoded.orderId, true)
        if (decoded.deliveryId !== undefined) {
          const recorded = yield* loadDelivery(decoded.tenantId, decoded.deliveryId)
          if (recorded !== undefined) return recorded
        }
        if (fulfillment.status !== "confirmed") {
          return yield* Effect.fail(
            new SalesOrderInvalidState({
              tenantId: decoded.tenantId,
              orderId: decoded.orderId,
              status: fulfillment.status,
            }),
          )
        }
        const byLine = new Map(fulfillment.lines.map((line) => [line.orderLineId, line]))
        for (const line of decoded.lines) {
          const ordered = byLine.get(line.orderLineId)
          if (ordered === undefined) {
            return yield* Effect.fail(
              new OrderLineNotFound({
                tenantId: decoded.tenantId,
                orderId: decoded.orderId,
                orderLineId: line.orderLineId,
              }),
            )
          }
          if (BigInt(ordered.delivered) + BigInt(line.quantity) > BigInt(ordered.quantity)) {
            return yield* Effect.fail(
              new DeliveryExceedsOrder({
                tenantId: decoded.tenantId,
                orderLineId: line.orderLineId,
                ordered: ordered.quantity,
                requested: (BigInt(ordered.delivered) + BigInt(line.quantity)).toString(),
              }),
            )
          }
        }
        const deliveryId = decoded.deliveryId ?? uuidv7()
        const allocated = yield* numbering
          .allocate({
            tenantId: decoded.tenantId,
            scopeId: fulfillment.legalEntityId,
            documentType: "sales.delivery",
            documentId: deliveryId,
            documentDate: decoded.deliveryDate,
            prefix: "DO/",
          })
          .pipe(Effect.catchTag("SchemaError", (error) => Effect.die(error)))
        yield* database.transaction(async (tx) => {
          await tx.insert(deliveries).values({
            id: deliveryId,
            tenantId: decoded.tenantId,
            orderId: decoded.orderId,
            legalEntityId: fulfillment.legalEntityId,
            warehouseId: decoded.warehouseId,
            number: allocated.number,
            deliveryDate: decoded.deliveryDate,
          })
          await tx.insert(deliveryLines).values(
            decoded.lines.map((line) => ({
              tenantId: decoded.tenantId,
              deliveryId,
              orderId: decoded.orderId,
              orderLineId: line.orderLineId,
              quantity: line.quantity,
            })),
          )
        }, "sales.delivery.record")
        return {
          id: deliveryId,
          tenantId: decoded.tenantId,
          number: allocated.number,
          orderId: decoded.orderId,
          legalEntityId: fulfillment.legalEntityId,
          warehouseId: decoded.warehouseId,
          deliveryDate: decoded.deliveryDate,
          lines: decoded.lines.map((line) => ({
            orderLineId: line.orderLineId,
            productId: byLine.get(line.orderLineId)!.productId,
            quantity: line.quantity,
          })),
        } satisfies Delivery
      }),
      "sales.delivery.atomic",
    )
  })

  return {
    createPartyCustomer,
    createPriceList,
    setPrice,
    assignCustomerPriceList,
    draftQuotation,
    getQuotation,
    sendQuotation: Effect.fn("SalesDocumentService.sendQuotation")((input: unknown) =>
      transition(input, SalesCapabilities.quotationSend, "draft", "sent"),
    ),
    acceptQuotation: Effect.fn("SalesDocumentService.acceptQuotation")((input: unknown) =>
      transition(input, SalesCapabilities.quotationDecide, "sent", "accepted"),
    ),
    rejectQuotation: Effect.fn("SalesDocumentService.rejectQuotation")((input: unknown) =>
      transition(input, SalesCapabilities.quotationDecide, "sent", "rejected"),
    ),
    expireQuotations,
    convertQuotation,
    getFulfillment,
    recordDelivery,
  } satisfies SalesDocumentService
})

export const SalesDocumentsLive = Layer.effect(SalesDocumentService, makeSalesDocumentService)
