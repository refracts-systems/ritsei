import { and, asc, eq, or, gt, sql } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  items,
  itemValuations,
  movements,
  stockBalances,
  valuationEntries,
  warehouses,
} from "../../../../db/schema/inventory.ts"
import {
  Database,
  type DrizzleTransaction,
  formatSignedMinor,
  requireExactMajorToMinor,
  requireSignedMajorToMinor,
} from "../../../../framework/foundation/mod.ts"
import type { Principal as PrincipalSchema } from "../../../../framework/modules/auth/mod.ts"
import {
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { GeneralLedgerService, type PostingRoleType } from "../../accounting/mod.ts"
import { ProductService } from "../../product/mod.ts"
import { InventoryCapabilities } from "./capabilities.ts"
import {
  InventoryReferenceNotFound,
  StockNotStockable,
  StockUnavailable,
  StockValuationUnavailable,
} from "./errors.ts"
import {
  CountStockInput,
  IssueValuedStockInput,
  ReceiveValuedStockInput,
  RegisterProductItemInput,
  StockKeepingService,
  type ValuedStockMovement,
  ValuationReportInput,
} from "./stock-keeping-contract.ts"

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

/** Round `numerator / denominator` half up; both are non-negative. */
const divideHalfUp = (numerator: bigint, denominator: bigint) =>
  (numerator * 2n + denominator) / (denominator * 2n)

type Principal = Schema.Schema.Type<typeof PrincipalSchema>

/** A planned stock change: signed quantity, and for gains the value it adds. */
type PlannedLine = {
  readonly itemId: string
  readonly quantity: bigint
  /** Receipts carry their value; issues and losses take the moving-average cost. */
  readonly receiptValue?: bigint
  /** An issue at a stated cost instead of the moving average. */
  readonly issueValue?: bigint
  /** Gains without a receipt value use the average cost, or this cost when nothing is valued. */
  readonly fallbackUnitCost?: bigint
}

type Plan = {
  readonly principal: Principal
  readonly tenantId: string
  readonly warehouseId: string
  readonly postingDate: string
  readonly source: { readonly type: string; readonly id: string }
  readonly reason: string
  readonly itemIds: ReadonlyArray<string>
  /** Resolves the changes against locked on-hand stock; a count compares counted quantities. */
  readonly resolve: (onHand: ReadonlyMap<string, bigint>) => ReadonlyArray<PlannedLine>
  readonly gainRole: PostingRoleType
  readonly lossRole: PostingRoleType
}

type ValuedLine = { readonly itemId: string; readonly quantity: bigint; readonly value: bigint }
type Balance = { readonly onHand: bigint; readonly reserved: bigint }
type Valuation = { readonly quantity: bigint; readonly value: bigint }
type LockedStock = {
  readonly units: Map<string, string>
  readonly balances: Map<string, Balance>
  readonly valuations: Map<string, Valuation>
}
type LineValue =
  | { readonly _tag: "valued"; readonly line: ValuedLine }
  | { readonly _tag: "unavailable" }
  | { readonly _tag: "unvalued" }

/** An issue removes the moving-average cost, or its stated cost, from valued stock. */
const valueIssue = (line: PlannedLine, balance: Balance, valuation: Valuation): LineValue => {
  const quantity = -line.quantity
  if (balance.onHand - balance.reserved < quantity) return { _tag: "unavailable" }
  if (valuation.quantity < quantity) return { _tag: "unvalued" }
  // The last units take the remaining value, so rounding or a stated cost never strands value.
  const cost =
    quantity === valuation.quantity
      ? valuation.value
      : (line.issueValue ?? divideHalfUp(valuation.value * quantity, valuation.quantity))
  if (cost > valuation.value) return { _tag: "unvalued" }
  return { _tag: "valued", line: { itemId: line.itemId, quantity: line.quantity, value: -cost } }
}

/** A receipt adds its value; a gain without one takes the average or the fallback cost. */
const valueReceipt = (line: PlannedLine, valuation: Valuation): LineValue => {
  const value =
    line.receiptValue ??
    (valuation.quantity > 0n
      ? divideHalfUp(valuation.value * line.quantity, valuation.quantity)
      : line.fallbackUnitCost === undefined
        ? undefined
        : line.fallbackUnitCost * line.quantity)
  return value === undefined
    ? { _tag: "unvalued" }
    : { _tag: "valued", line: { itemId: line.itemId, quantity: line.quantity, value } }
}

const valueLine = (line: PlannedLine, balance: Balance, valuation: Valuation) =>
  line.quantity < 0n ? valueIssue(line, balance, valuation) : valueReceipt(line, valuation)

/** One journal per document: gains against the gain role, losses against the loss role. */
const journalFor = (
  valued: ReadonlyArray<ValuedLine>,
  gainRole: PostingRoleType,
  lossRole: PostingRoleType,
) => {
  const gains = valued.reduce((sum, line) => (line.value > 0n ? sum + line.value : sum), 0n)
  const losses = valued.reduce((sum, line) => (line.value < 0n ? sum - line.value : sum), 0n)
  return [
    ...(gains > 0n
      ? [
          { role: "inventory" as const, debit: major(gains), credit: "0" },
          { role: gainRole, debit: "0", credit: major(gains) },
        ]
      : []),
    ...(losses > 0n
      ? [
          { role: lossRole, debit: major(losses), credit: "0" },
          { role: "inventory" as const, debit: "0", credit: major(losses) },
        ]
      : []),
  ]
}

/** The tagged failure for a line that cannot move. */
const lineFailure = (
  reason: "unavailable" | "unvalued",
  plan: Plan,
  legalEntityId: string,
  line: PlannedLine,
) => {
  const requested = (line.quantity < 0n ? -line.quantity : line.quantity).toString()
  const scope = { tenantId: plan.tenantId, itemId: line.itemId, requested }
  return reason === "unavailable"
    ? new StockUnavailable({ ...scope, warehouseId: plan.warehouseId })
    : new StockValuationUnavailable({ ...scope, legalEntityId })
}

export const makeStockKeepingService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const authorized = scopedCommand(authorization)
  const ledger = yield* GeneralLedgerService
  const productService = yield* ProductService

  const replay = (tenantId: string, source: Plan["source"], legalEntityId: string) =>
    database
      .query(
        (db) =>
          db
            .select({
              itemId: valuationEntries.itemId,
              movementId: valuationEntries.movementId,
              quantity: valuationEntries.quantity,
              value: valuationEntries.value,
              journalEntryId: valuationEntries.journalEntryId,
            })
            .from(valuationEntries)
            .where(
              and(
                eq(valuationEntries.tenantId, tenantId),
                eq(valuationEntries.sourceType, source.type),
                eq(valuationEntries.sourceId, source.id),
              ),
            )
            .orderBy(asc(valuationEntries.itemId)),
        "inventory.valuation.replay",
      )
      .pipe(
        Effect.map((rows): ValuedStockMovement | undefined =>
          rows.length === 0
            ? undefined
            : {
                legalEntityId,
                source,
                lines: rows.map((row) => ({
                  itemId: row.itemId,
                  movementId: row.movementId,
                  quantity: row.quantity,
                  value: major(requireSignedMajorToMinor(row.value, 2)),
                })),
                journalEntryId: rows[0]!.journalEntryId,
              },
        ),
      )

  /** Locks balances and valuations in item order so concurrent documents cannot deadlock. */
  const lockStock = (plan: Plan, legalEntityId: string) =>
    database.transaction(async (tx) => {
      const state: LockedStock = { units: new Map(), balances: new Map(), valuations: new Map() }
      for (const itemId of [...new Set(plan.itemIds)].toSorted()) {
        const item = (
          await tx
            .select({ unitOfMeasure: items.unitOfMeasure })
            .from(items)
            .where(and(eq(items.tenantId, plan.tenantId), eq(items.id, itemId)))
        )[0]
        if (item === undefined) return { missingItemId: itemId }
        state.units.set(itemId, item.unitOfMeasure)
        const balance = (
          await tx
            .select({ onHand: stockBalances.onHand, reserved: stockBalances.reserved })
            .from(stockBalances)
            .where(
              and(
                eq(stockBalances.tenantId, plan.tenantId),
                eq(stockBalances.warehouseId, plan.warehouseId),
                eq(stockBalances.itemId, itemId),
              ),
            )
            .for("update")
        )[0]
        state.balances.set(itemId, {
          onHand: BigInt(balance?.onHand ?? "0"),
          reserved: BigInt(balance?.reserved ?? "0"),
        })
        await tx
          .insert(itemValuations)
          .values({ tenantId: plan.tenantId, legalEntityId, itemId })
          .onConflictDoNothing()
        const valuation = (
          await tx
            .select({ quantity: itemValuations.quantity, value: itemValuations.value })
            .from(itemValuations)
            .where(
              and(
                eq(itemValuations.tenantId, plan.tenantId),
                eq(itemValuations.legalEntityId, legalEntityId),
                eq(itemValuations.itemId, itemId),
              ),
            )
            .for("update")
        )[0]!
        state.valuations.set(itemId, {
          quantity: BigInt(valuation.quantity),
          value: requireExactMajorToMinor(valuation.value, 2),
        })
      }
      return { state }
    }, "inventory.valuation.lock")

  /** Writes one valued line: balance, movement, valuation, and its valuation entry. */
  const writeLine = async (
    tx: DrizzleTransaction,
    plan: Plan,
    legalEntityId: string,
    line: ValuedLine,
    unitOfMeasure: string,
    journalEntryId: string | null,
  ) => {
    const delta = sql`${stockBalances.onHand} + ${line.quantity.toString()}`
    if (line.quantity > 0n) {
      await tx
        .insert(stockBalances)
        .values({
          tenantId: plan.tenantId,
          warehouseId: plan.warehouseId,
          itemId: line.itemId,
          onHand: line.quantity.toString(),
        })
        .onConflictDoUpdate({
          target: [stockBalances.tenantId, stockBalances.warehouseId, stockBalances.itemId],
          set: { onHand: delta, updatedAt: new Date() },
        })
    } else {
      // The balance row exists and is locked: availability was checked against it.
      await tx
        .update(stockBalances)
        .set({ onHand: delta, updatedAt: new Date() })
        .where(
          and(
            eq(stockBalances.tenantId, plan.tenantId),
            eq(stockBalances.warehouseId, plan.warehouseId),
            eq(stockBalances.itemId, line.itemId),
          ),
        )
    }
    const movement = (
      await tx
        .insert(movements)
        .values({
          tenantId: plan.tenantId,
          warehouseId: plan.warehouseId,
          itemId: line.itemId,
          quantity: line.quantity.toString(),
          kind: line.quantity > 0n ? "receipt" : "issue",
          referenceId: plan.source.id,
          unitOfMeasure,
          reason: plan.reason,
          idempotencyKey: `${plan.source.type}:${plan.source.id}:${line.itemId}`,
        })
        .returning({ id: movements.id })
    )[0]!
    await tx
      .update(itemValuations)
      .set({
        quantity: sql`${itemValuations.quantity} + ${line.quantity.toString()}`,
        value: sql`${itemValuations.value} + ${major(line.value)}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(itemValuations.tenantId, plan.tenantId),
          eq(itemValuations.legalEntityId, legalEntityId),
          eq(itemValuations.itemId, line.itemId),
        ),
      )
    await tx.insert(valuationEntries).values({
      tenantId: plan.tenantId,
      legalEntityId,
      itemId: line.itemId,
      movementId: movement.id,
      quantity: line.quantity.toString(),
      value: major(line.value),
      sourceType: plan.source.type,
      sourceId: plan.source.id,
      journalEntryId,
    })
    return {
      itemId: line.itemId,
      movementId: movement.id,
      quantity: line.quantity.toString(),
      value: major(line.value),
    }
  }

  const loadWarehouseLegalEntity = (plan: Plan) =>
    Effect.gen(function* () {
      const warehouse = (yield* database.query(
        (db) =>
          db
            .select({ legalEntityId: warehouses.legalEntityId })
            .from(warehouses)
            .where(and(eq(warehouses.tenantId, plan.tenantId), eq(warehouses.id, plan.warehouseId)))
            .for("share"),
        "inventory.valuation.warehouse",
      ))[0]
      if (warehouse === undefined) {
        return yield* Effect.fail(
          new InventoryReferenceNotFound({
            tenantId: plan.tenantId,
            warehouseId: plan.warehouseId,
            itemId: plan.itemIds[0]!,
          }),
        )
      }
      return warehouse.legalEntityId
    })

  /** Values every changed line against the locked stock, failing on the first that cannot move. */
  const valueAll = (plan: Plan, legalEntityId: string, state: LockedStock) =>
    Effect.gen(function* () {
      const onHand = new Map(
        [...state.balances].map(([itemId, balance]) => [itemId, balance.onHand]),
      )
      const valued: ValuedLine[] = []
      for (const line of plan.resolve(onHand).filter((candidate) => candidate.quantity !== 0n)) {
        const outcome = valueLine(
          line,
          state.balances.get(line.itemId)!,
          state.valuations.get(line.itemId)!,
        )
        if (outcome._tag !== "valued")
          return yield* Effect.fail(lineFailure(outcome._tag, plan, legalEntityId, line))
        valued.push(outcome.line)
      }
      return valued
    })

  const move = (plan: Plan) =>
    database.withTransaction(
      Effect.gen(function* () {
        const legalEntityId = yield* loadWarehouseLegalEntity(plan)
        const replayed = yield* replay(plan.tenantId, plan.source, legalEntityId)
        if (replayed !== undefined) return replayed
        const locked = yield* lockStock(plan, legalEntityId)
        if (locked.missingItemId !== undefined) {
          return yield* Effect.fail(
            new InventoryReferenceNotFound({
              tenantId: plan.tenantId,
              warehouseId: plan.warehouseId,
              itemId: locked.missingItemId,
            }),
          )
        }
        const state = locked.state!
        const valued = yield* valueAll(plan, legalEntityId, state)
        const journalLines = journalFor(valued, plan.gainRole, plan.lossRole)
        const journal =
          journalLines.length === 0
            ? null
            : yield* ledger.postDocumentEntry({
                principal: plan.principal,
                tenantId: plan.tenantId,
                legalEntityId,
                postingDate: plan.postingDate,
                reference: `inventory/${plan.source.type}/${plan.source.id}`,
                description: plan.reason,
                source: plan.source,
                lines: journalLines,
              })
        const written = yield* database.transaction(async (tx) => {
          const result: Array<ValuedStockMovement["lines"][number]> = []
          for (const line of valued.toSorted((left, right) =>
            left.itemId.localeCompare(right.itemId),
          )) {
            const unit = state.units.get(line.itemId)!
            result.push(await writeLine(tx, plan, legalEntityId, line, unit, journal?.id ?? null))
          }
          return result
        }, "inventory.valuation.write")
        return {
          legalEntityId,
          source: plan.source,
          lines: written,
          journalEntryId: journal?.id ?? null,
        } satisfies ValuedStockMovement
      }),
      "inventory.valuation.move",
    )

  const registerProductItem = Effect.fn("StockKeepingService.registerProductItem")(function* (
    input: unknown,
  ) {
    const decoded = yield* authorized(
      RegisterProductItemInput,
      InventoryCapabilities.itemCreate,
    )(input)
    const product = yield* productService.getProduct(decoded)
    if (product.type !== "stockable") {
      return yield* Effect.fail(
        new StockNotStockable({ tenantId: decoded.tenantId, productId: decoded.productId }),
      )
    }
    const rows = yield* database.query(
      (db) =>
        db
          .insert(items)
          .values({
            id: product.id,
            tenantId: product.tenantId,
            sku: product.code,
            name: product.name,
            unitOfMeasure: product.unitOfMeasure,
          })
          .onConflictDoNothing({ target: items.id })
          .returning(),
      "inventory.item.register_product",
    )
    const row =
      rows[0] ??
      (yield* database.query(
        (db) =>
          db
            .select()
            .from(items)
            .where(and(eq(items.tenantId, decoded.tenantId), eq(items.id, product.id))),
        "inventory.item.get",
      ))[0]!
    return {
      id: row.id,
      tenantId: row.tenantId,
      sku: row.sku,
      name: row.name,
      unitOfMeasure: row.unitOfMeasure,
    }
  })

  const receiveValued = Effect.fn("StockKeepingService.receiveValued")(function* (input: unknown) {
    const decoded = yield* authorized(
      ReceiveValuedStockInput,
      InventoryCapabilities.stockReceive,
    )(input)
    return yield* move({
      ...decoded,
      reason: `receipt ${decoded.source.type}`,
      gainRole: decoded.counterRole,
      lossRole: decoded.counterRole,
      itemIds: decoded.lines.map((line) => line.itemId),
      resolve: () =>
        decoded.lines.map((line) => ({
          itemId: line.itemId,
          quantity: BigInt(line.quantity),
          receiptValue: BigInt(line.quantity) * minor(line.unitCost),
        })),
    })
  })

  const issueValued = Effect.fn("StockKeepingService.issueValued")(function* (input: unknown) {
    const decoded = yield* authorized(
      IssueValuedStockInput,
      InventoryCapabilities.stockIssue,
    )(input)
    return yield* move({
      ...decoded,
      reason: `issue ${decoded.source.type}`,
      gainRole: decoded.counterRole,
      lossRole: decoded.counterRole,
      itemIds: decoded.lines.map((line) => line.itemId),
      resolve: () =>
        decoded.lines.map((line) => ({
          itemId: line.itemId,
          quantity: -BigInt(line.quantity),
          ...(line.unitCost === undefined
            ? {}
            : { issueValue: minor(line.unitCost) * BigInt(line.quantity) }),
        })),
    })
  })

  const countStock = Effect.fn("StockKeepingService.countStock")(function* (input: unknown) {
    const decoded = yield* authorized(CountStockInput, InventoryCapabilities.stockCount)(input)
    return yield* move({
      principal: decoded.principal,
      tenantId: decoded.tenantId,
      warehouseId: decoded.warehouseId,
      postingDate: decoded.postingDate,
      source: { type: "inventory.stock_count", id: decoded.countId },
      reason: "stock count",
      gainRole: "inventory_adjustment",
      lossRole: "inventory_adjustment",
      itemIds: decoded.lines.map((line) => line.itemId),
      resolve: (onHand) =>
        decoded.lines.map((line) => ({
          itemId: line.itemId,
          quantity: BigInt(line.countedQuantity) - (onHand.get(line.itemId) ?? 0n),
          ...(line.unitCost === undefined ? {} : { fallbackUnitCost: minor(line.unitCost) }),
        })),
    })
  })

  const valuation = Effect.fn("StockKeepingService.valuation")(function* (input: unknown) {
    const decoded = yield* authorized(
      ValuationReportInput,
      InventoryCapabilities.valuationRead,
    )(input)
    const rows = yield* database.query(
      (db) =>
        db
          .select({
            itemId: itemValuations.itemId,
            quantity: itemValuations.quantity,
            value: itemValuations.value,
          })
          .from(itemValuations)
          .where(
            and(
              eq(itemValuations.tenantId, decoded.tenantId),
              eq(itemValuations.legalEntityId, decoded.legalEntityId),
              or(gt(itemValuations.quantity, "0"), gt(itemValuations.value, "0")),
            ),
          )
          .orderBy(asc(itemValuations.itemId)),
      "inventory.valuation.report",
    )
    const normalized = rows.map((row) => ({
      itemId: row.itemId,
      quantity: row.quantity,
      value: major(requireExactMajorToMinor(row.value, 2)),
    }))
    return {
      legalEntityId: decoded.legalEntityId,
      rows: normalized,
      totalValue: major(normalized.reduce((sum, row) => sum + minor(row.value), 0n)),
    }
  })

  return {
    registerProductItem,
    receiveValued,
    issueValued,
    countStock,
    valuation,
  } satisfies StockKeepingService
})

export const StockKeepingLive = Layer.effect(StockKeepingService, makeStockKeepingService)
