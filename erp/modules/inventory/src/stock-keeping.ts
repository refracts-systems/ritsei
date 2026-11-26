import { and, asc, eq, inArray, or, gt, sql } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  items,
  itemValuations,
  movements,
  serialUnits,
  openingStockPositions,
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
  omitUndefined,
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
  firstUncarried,
  OpeningRejection,
  requestedOpeningRows,
  sameOpeningBundle,
} from "./opening-stock-rules.ts"
import {
  InventoryReferenceNotFound,
  OpeningStockAlreadyLoaded,
  OpeningStockConflict,
  OpeningStockInTransitNotCarried,
  OpeningStockLotTrackingUnsupported,
  OpeningStockReservationsNotCarried,
  ItemTrackingLocked,
  StockNotStockable,
  StockUnavailable,
  StockValuationUnavailable,
} from "./errors.ts"
import {
  CountStockInput,
  IssueValuedStockInput,
  type OpeningRevaluation,
  OpeningStockInput,
  type OpeningStockLoad,
  LookupSerialInput,
  ReceiveValuedStockInput,
  RegisterProductItemInput,
  SetItemTrackingInput,
  type SerialRecord,
  type StockIdentity,
  StockKeepingService,
  type ValuedStockMovement,
  ValuationReportInput,
} from "./stock-keeping-contract.ts"
import {
  availabilityProblem,
  identityFailure,
  identityKey,
  identityMismatch,
  recordedIdentityKeys,
  trackingOf,
  writeIdentity,
} from "./tracking.ts"
import {
  type Balance,
  LineValue,
  type PlannedLine,
  type Valuation,
  type ValuedLine,
  valueLine,
} from "./valuation.ts"

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

type Principal = Schema.Schema.Type<typeof PrincipalSchema>

/** What locking and writing stock need of a move. */
type Movement = {
  readonly tenantId: string
  readonly warehouseId: string
  readonly source: { readonly type: string; readonly id: string }
  readonly reason: string
  readonly itemIds: ReadonlyArray<string>
}

type Plan = Movement & {
  /** Resolves the changes against locked on-hand stock; a count compares counted quantities. */
  readonly resolve: (onHand: ReadonlyMap<string, bigint>) => ReadonlyArray<PlannedLine>
  readonly principal: Principal
  readonly postingDate: string
  readonly gainRole: PostingRoleType
  readonly lossRole: PostingRoleType
  /** The lot or serials each line moves by, for tracked items (ADR-0131). */
  readonly identities?: ReadonlyMap<string, StockIdentity | undefined>
}

type LockedStock = {
  readonly units: Map<string, string>
  readonly balances: Map<string, Balance>
  readonly valuations: Map<string, Valuation>
}

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
  plan: Movement,
  legalEntityId: string,
  line: PlannedLine,
) => {
  const requested = (line.quantity < 0n ? -line.quantity : line.quantity).toString()
  const scope = { tenantId: plan.tenantId, itemId: line.itemId, requested }

  return reason === "unavailable"
    ? new StockUnavailable({ ...scope, warehouseId: plan.warehouseId })
    : new StockValuationUnavailable({ ...scope, legalEntityId })
}

/** One loaded line; every amount is minor units. */
type OpeningRow = {
  readonly itemId: string
  readonly movementId: string
  readonly quantity: bigint
  readonly sourceValue: bigint
  readonly value: bigint
}

/** Distinct from the source type earlier opening receipts used, which carry no position. */
const OPENING_SOURCE_TYPE = "inventory.opening_stock_load"

/** The first source position the load does not carry, as the error the caller receives. */
const openingRejection = (
  tenantId: string,
  lines: Schema.Schema.Type<typeof OpeningStockInput>["lines"],
) => {
  const uncarried = firstUncarried(
    lines.map((line) => ({ ...line, identified: line.identity !== undefined })),
  )

  return uncarried === undefined
    ? undefined
    : OpeningRejection.$match(uncarried, {
        LotTrackingUnsupported: ({ itemId, tracking }) =>
          new OpeningStockLotTrackingUnsupported({ tenantId, itemId, tracking }),
        ReservationsNotCarried: ({ itemId, reserved }) =>
          new OpeningStockReservationsNotCarried({ tenantId, itemId, reserved }),
        InTransitNotCarried: ({ itemId, inTransit }) =>
          new OpeningStockInTransitNotCarried({ tenantId, itemId, inTransit }),
      })
}

/**
 * The opening journal: inventory takes the value held, migration clearing gives the source total
 * the source's control balance ties to, and the revaluation difference goes to inventory
 * adjustment (ADR-0117, ADR-0118). Zero amounts are left out, so all-zero stock posts nothing.
 */
const openingJournalFor = (rows: ReadonlyArray<OpeningRow>) => {
  const sourceValue = rows.reduce((sum, row) => sum + row.sourceValue, 0n)
  const value = rows.reduce((sum, row) => sum + row.value, 0n)
  const adjustment = value - sourceValue

  return [
    { role: "inventory" as const, debit: value, credit: 0n },
    { role: "migration_clearing" as const, debit: 0n, credit: sourceValue },
    {
      role: "inventory_adjustment" as const,
      debit: adjustment < 0n ? -adjustment : 0n,
      credit: adjustment > 0n ? adjustment : 0n,
    },
  ].flatMap((line) =>
    line.debit > 0n || line.credit > 0n
      ? [{ role: line.role, debit: major(line.debit), credit: major(line.credit) }]
      : [],
  )
}

/** The loaded position: the source total to clear, the revaluation difference, and the value held. */
const toOpeningLoad = (
  legalEntityId: string,
  opening: Pick<
    Schema.Schema.Type<typeof OpeningStockInput>,
    "openingId" | "warehouseId" | "cutoffDate"
  >,
  rows: ReadonlyArray<OpeningRow>,
  journalEntryId: string | null,
): OpeningStockLoad => {
  const total = (pick: (row: OpeningRow) => bigint) =>
    rows.reduce((sum, row) => sum + pick(row), 0n)

  return {
    legalEntityId,
    openingId: opening.openingId,
    warehouseId: opening.warehouseId,
    cutoffDate: opening.cutoffDate,
    journalEntryId,
    lines: rows.map((row) => ({
      itemId: row.itemId,
      movementId: row.movementId,
      quantity: row.quantity.toString(),
      sourceValue: major(row.sourceValue),
      value: major(row.value),
      adjustment: major(row.value - row.sourceValue),
    })),
    valueToClear: major(total((row) => row.sourceValue)),
    adjustment: major(total((row) => row.value - row.sourceValue)),
    value: major(total((row) => row.value)),
  }
}

/** The approval columns of an opening position; all null when the line was not revalued. */
const approvalColumns = (
  revaluation: Schema.Schema.Type<typeof OpeningRevaluation> | undefined,
) => ({
  adjustmentName: revaluation?.name ?? null,
  approvedBy: revaluation?.approvedBy ?? null,
  approvedAt: revaluation === undefined ? null : new Date(revaluation.approvedAt),
  approvalReference: revaluation?.reference ?? null,
})

export const makeStockKeepingService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const authorized = scopedCommand(authorization)
  const ledger = yield* GeneralLedgerService
  const productService = yield* ProductService

  const replay = (tenantId: string, source: Movement["source"], legalEntityId: string) =>
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
  const lockStock = (plan: Movement, legalEntityId: string) =>
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
    plan: Movement,
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

  const loadWarehouseLegalEntity = (plan: Movement) =>
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

        const failure = LineValue.$match(outcome, {
          Valued: (value) => {
            valued.push(value.line)

            return undefined
          },
          Unavailable: () => lineFailure("unavailable", plan, legalEntityId, line),
          Unvalued: () => lineFailure("unvalued", plan, legalEntityId, line),
        })

        if (failure !== undefined) return yield* Effect.fail(failure)
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

        // A tracked item moves only by identity, checked while its balance is locked.
        const modes = yield* database.transaction(async (tx) => {
          const tracking = await trackingOf(
            tx,
            plan.tenantId,
            valued.map((line) => line.itemId),
          )

          for (const line of valued) {
            const mode = tracking.get(line.itemId) ?? "none"

            const candidate = {
              itemId: line.itemId,
              quantity: line.quantity,
              identity: plan.identities?.get(line.itemId),
            }

            const problem =
              identityMismatch(line.itemId, mode, line.quantity, candidate.identity) ??
              (await availabilityProblem(tx, plan.tenantId, plan.warehouseId, mode, candidate))

            if (problem !== undefined) return { problem }
          }

          return { tracking }
        }, "inventory.tracking.verify")

        if (modes.problem !== undefined) {
          return yield* Effect.fail(identityFailure(plan.tenantId, modes.problem))
        }

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

          // Shapes and availability were checked above, so the guard may let tracked stock move.
          await tx.execute(sql`select set_config('ritsei.tracked_identity', 'on', true)`)

          for (const line of valued.toSorted((left, right) =>
            left.itemId.localeCompare(right.itemId),
          )) {
            const unit = state.units.get(line.itemId)!

            const movement = await writeLine(
              tx,
              plan,
              legalEntityId,
              line,
              unit,
              journal?.id ?? null,
            )

            result.push(movement)

            await writeIdentity(tx, {
              tenantId: plan.tenantId,
              warehouseId: plan.warehouseId,
              source: plan.source,
              movementId: movement.movementId,
              tracking: modes.tracking!.get(line.itemId) ?? "none",
              line: {
                itemId: line.itemId,
                quantity: line.quantity,
                identity: plan.identities?.get(line.itemId),
              },
            })
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
    input: Schema.Codec.Encoded<typeof RegisterProductItemInput>,
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
            tracking: decoded.tracking ?? "none",
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

  const setItemTracking = Effect.fn("StockKeepingService.setItemTracking")(function* (
    input: Schema.Codec.Encoded<typeof SetItemTrackingInput>,
  ) {
    const decoded = yield* authorized(SetItemTrackingInput, InventoryCapabilities.itemCreate)(input)

    return yield* database.withTransaction(
      Effect.gen(function* () {
        const item = (yield* database.query(
          (db) =>
            db
              .select({ id: items.id })
              .from(items)
              .where(and(eq(items.tenantId, decoded.tenantId), eq(items.id, decoded.itemId)))
              .for("update"),
          "inventory.item.lock",
        ))[0]

        if (item === undefined) {
          return yield* Effect.fail(
            new InventoryReferenceNotFound({
              tenantId: decoded.tenantId,
              warehouseId: decoded.itemId,
              itemId: decoded.itemId,
            }),
          )
        }

        // A mode that is already set is not a change; otherwise stock or history locks it.
        const used = yield* database.query(
          (db) =>
            db
              .select({ id: movements.id })
              .from(movements)
              .where(
                and(eq(movements.tenantId, decoded.tenantId), eq(movements.itemId, decoded.itemId)),
              )
              .limit(1),
          "inventory.item.movements",
        )

        const held = yield* database.query(
          (db) =>
            db
              .select({ onHand: stockBalances.onHand })
              .from(stockBalances)
              .where(
                and(
                  eq(stockBalances.tenantId, decoded.tenantId),
                  eq(stockBalances.itemId, decoded.itemId),
                  gt(stockBalances.onHand, "0"),
                ),
              )
              .limit(1),
          "inventory.item.stock",
        )

        const current = (yield* database.query(
          (db) =>
            db
              .select({ tracking: items.tracking })
              .from(items)
              .where(and(eq(items.tenantId, decoded.tenantId), eq(items.id, decoded.itemId))),
          "inventory.item.tracking",
        ))[0]!.tracking

        if (current !== decoded.tracking && (used.length > 0 || held.length > 0)) {
          return yield* Effect.fail(
            new ItemTrackingLocked({ tenantId: decoded.tenantId, itemId: decoded.itemId }),
          )
        }

        yield* database.query(
          (db) =>
            db
              .update(items)
              .set({ tracking: decoded.tracking, updatedAt: new Date() })
              .where(and(eq(items.tenantId, decoded.tenantId), eq(items.id, decoded.itemId))),
          "inventory.item.set_tracking",
        )

        return { itemId: decoded.itemId, tracking: decoded.tracking }
      }),
      "inventory.item.set_tracking.atomic",
    )
  })

  const lookupSerial = Effect.fn("StockKeepingService.lookupSerial")(function* (
    input: Schema.Codec.Encoded<typeof LookupSerialInput>,
  ) {
    const decoded = yield* authorized(LookupSerialInput, InventoryCapabilities.stockRead)(input)

    const rows = yield* database.query(
      (db) =>
        db
          .select()
          .from(serialUnits)
          .where(
            and(eq(serialUnits.tenantId, decoded.tenantId), eq(serialUnits.serial, decoded.serial)),
          )
          .orderBy(asc(serialUnits.itemId)),
      "inventory.serial.lookup",
    )

    return rows.map((row): SerialRecord => ({
      itemId: row.itemId,
      serial: row.serial,
      status: row.status,
      warehouseId: row.warehouseId,
      issuedBy:
        row.issuedSourceType === null || row.issuedSourceId === null
          ? null
          : { type: row.issuedSourceType, id: row.issuedSourceId },
      issuedAt: row.issuedAt?.toISOString() ?? null,
    }))
  })

  const receiveValued = Effect.fn("StockKeepingService.receiveValued")(function* (
    input: Schema.Codec.Encoded<typeof ReceiveValuedStockInput>,
  ) {
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
      identities: new Map(decoded.lines.map((line) => [line.itemId, line.identity])),
      resolve: () =>
        decoded.lines.map((line) => ({
          itemId: line.itemId,
          quantity: BigInt(line.quantity),
          receiptValue: BigInt(line.quantity) * minor(line.unitCost),
        })),
    })
  })

  const issueValued = Effect.fn("StockKeepingService.issueValued")(function* (
    input: Schema.Codec.Encoded<typeof IssueValuedStockInput>,
  ) {
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
      identities: new Map(decoded.lines.map((line) => [line.itemId, line.identity])),
      resolve: () =>
        decoded.lines.map((line) => ({
          itemId: line.itemId,
          quantity: -BigInt(line.quantity),
          ...omitUndefined({
            issueValue:
              line.unitCost === undefined
                ? undefined
                : minor(line.unitCost) * BigInt(line.quantity),
          }),
        })),
    })
  })

  const countStock = Effect.fn("StockKeepingService.countStock")(function* (
    input: Schema.Codec.Encoded<typeof CountStockInput>,
  ) {
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
          ...omitUndefined({
            fallbackUnitCost: line.unitCost === undefined ? undefined : minor(line.unitCost),
          }),
        })),
    })
  })

  /** The recorded opening load of a document, with the warehouse it was loaded into. */
  const recordedOpening = (tenantId: string, openingId: string) =>
    database.query(
      (db) =>
        db
          .select({
            warehouseId: openingStockPositions.warehouseId,
            cutoffDate: openingStockPositions.cutoffDate,
            itemId: openingStockPositions.itemId,
            movementId: openingStockPositions.movementId,
            quantity: openingStockPositions.quantity,
            sourceValue: openingStockPositions.sourceValue,
            value: valuationEntries.value,
            journalEntryId: valuationEntries.journalEntryId,
          })
          .from(valuationEntries)
          .innerJoin(
            openingStockPositions,
            and(
              eq(openingStockPositions.tenantId, valuationEntries.tenantId),
              eq(openingStockPositions.movementId, valuationEntries.movementId),
            ),
          )
          .where(
            and(
              eq(valuationEntries.tenantId, tenantId),
              eq(valuationEntries.sourceType, OPENING_SOURCE_TYPE),
              eq(valuationEntries.sourceId, openingId),
            ),
          )
          .orderBy(asc(valuationEntries.itemId)),
      "inventory.opening_stock.recorded",
    )

  /** Posts the opening journal at the cutoff; null when the stock carries no value. */
  const postOpeningJournal = (
    decoded: Schema.Schema.Type<typeof OpeningStockInput>,
    legalEntityId: string,
    rows: ReadonlyArray<OpeningRow>,
  ) => {
    const lines = openingJournalFor(rows)

    return lines.length === 0
      ? Effect.succeed(null)
      : ledger
          .postDocumentEntry({
            principal: decoded.principal,
            tenantId: decoded.tenantId,
            legalEntityId,
            postingDate: decoded.cutoffDate,
            reference: `inventory/${OPENING_SOURCE_TYPE}/${decoded.openingId}`,
            description: decoded.revaluation?.name ?? "opening stock",
            source: { type: OPENING_SOURCE_TYPE, id: decoded.openingId },
            lines,
          })
          .pipe(Effect.map((entry) => entry.id))
  }

  const loadOpeningStock = Effect.fn("StockKeepingService.loadOpeningStock")(function* (
    input: Schema.Codec.Encoded<typeof OpeningStockInput>,
  ) {
    const decoded = yield* authorized(
      OpeningStockInput,
      InventoryCapabilities.openingStockLoad,
    )(input)

    const rejection = openingRejection(decoded.tenantId, decoded.lines)

    if (rejection !== undefined) return yield* Effect.fail(rejection)

    const requested = requestedOpeningRows(decoded.lines).map((row) => ({
      ...row,
      movementId: "",
    }))

    const movement: Movement = {
      tenantId: decoded.tenantId,
      warehouseId: decoded.warehouseId,
      source: { type: OPENING_SOURCE_TYPE, id: decoded.openingId },
      reason: "opening stock",
      itemIds: requested.map((row) => row.itemId),
    }

    return yield* database.withTransaction(
      Effect.gen(function* () {
        const legalEntityId = yield* loadWarehouseLegalEntity(movement)

        // Locking the valuation rows first serializes two loads of one item, so the reads below
        // see whatever the other load committed.
        const locked = yield* lockStock(movement, legalEntityId)

        if (locked.missingItemId !== undefined) {
          return yield* Effect.fail(
            new InventoryReferenceNotFound({
              tenantId: decoded.tenantId,
              warehouseId: decoded.warehouseId,
              itemId: locked.missingItemId,
            }),
          )
        }

        const recorded = yield* recordedOpening(decoded.tenantId, decoded.openingId)

        if (recorded.length > 0) {
          const rows = recorded.map((row) => ({
            itemId: row.itemId,
            movementId: row.movementId,
            quantity: BigInt(row.quantity),
            sourceValue: requireExactMajorToMinor(row.sourceValue, 2),
            value: requireExactMajorToMinor(row.value ?? "0", 2),
          }))

          const recordedIdentities = yield* database.transaction(
            (tx) =>
              recordedIdentityKeys(
                tx,
                decoded.tenantId,
                movement.source,
                new Map(recorded.map((row) => [row.movementId, row.itemId])),
              ),
            "inventory.opening_stock.identity",
          )

          // Lots and serials are part of the bundle: a retry must name the same ones.
          const sameIdentity = decoded.lines.every(
            (line) => identityKey(line.identity) === (recordedIdentities.get(line.itemId) ?? ""),
          )

          // A document is one approved bundle: a retry repeats it, and a changed one is a conflict.
          return sameIdentity &&
            sameOpeningBundle(
              { warehouseId: recorded[0]!.warehouseId, cutoffDate: recorded[0]!.cutoffDate, rows },
              { warehouseId: decoded.warehouseId, cutoffDate: decoded.cutoffDate, rows: requested },
            )
            ? toOpeningLoad(legalEntityId, decoded, rows, recorded[0]!.journalEntryId)
            : yield* Effect.fail(
                new OpeningStockConflict({
                  tenantId: decoded.tenantId,
                  openingId: decoded.openingId,
                }),
              )
        }

        const opened = (yield* database.query(
          (db) =>
            db
              .select({ itemId: openingStockPositions.itemId })
              .from(openingStockPositions)
              .where(
                and(
                  eq(openingStockPositions.tenantId, decoded.tenantId),
                  eq(openingStockPositions.warehouseId, decoded.warehouseId),
                  inArray(openingStockPositions.itemId, movement.itemIds),
                ),
              )
              .limit(1),
          "inventory.opening_stock.opened",
        ))[0]

        if (opened !== undefined) {
          return yield* Effect.fail(
            new OpeningStockAlreadyLoaded({
              tenantId: decoded.tenantId,
              warehouseId: decoded.warehouseId,
              itemId: opened.itemId,
            }),
          )
        }

        const state = locked.state!
        const revaluation = decoded.revaluation

        // A tracked item is carried only by its lots or serials, checked before anything is posted.
        const modes = yield* database.transaction(async (tx) => {
          const tracking = await trackingOf(tx, decoded.tenantId, movement.itemIds)

          for (const request of requested) {
            const mode = tracking.get(request.itemId) ?? "none"

            const candidate = {
              itemId: request.itemId,
              quantity: request.quantity,
              identity: decoded.lines.find((line) => line.itemId === request.itemId)?.identity,
            }

            const problem =
              identityMismatch(request.itemId, mode, request.quantity, candidate.identity) ??
              (await availabilityProblem(
                tx,
                decoded.tenantId,
                decoded.warehouseId,
                mode,
                candidate,
              ))

            if (problem !== undefined) return { problem }
          }

          return { tracking }
        }, "inventory.opening_stock.tracking")

        if (modes.problem !== undefined) {
          return yield* Effect.fail(identityFailure(decoded.tenantId, modes.problem))
        }

        // The journal joins this transaction, so a later failure rolls back the posting too, and
        // a retry that finds the recorded load never reaches this point to post again.
        const journalEntryId = yield* postOpeningJournal(decoded, legalEntityId, requested)

        const rows = yield* database.transaction(async (tx) => {
          const written: OpeningRow[] = []

          // Shapes and availability were checked above, so the guard may let tracked stock in.
          await tx.execute(sql`select set_config('ritsei.tracked_identity', 'on', true)`)

          // The receipt value is the value held, so the valuation entry stays one receipt per line.
          for (const request of requested) {
            const stated = decoded.lines.find((line) => line.itemId === request.itemId)!

            const result = await writeLine(
              tx,
              movement,
              legalEntityId,
              { itemId: request.itemId, quantity: request.quantity, value: request.value },
              state.units.get(request.itemId)!,
              journalEntryId,
            )

            await tx.insert(openingStockPositions).values({
              tenantId: decoded.tenantId,
              warehouseId: decoded.warehouseId,
              itemId: request.itemId,
              movementId: result.movementId,
              cutoffDate: decoded.cutoffDate,
              quantity: request.quantity.toString(),
              sourceValue: major(request.sourceValue),
              adjustment: major(request.value - request.sourceValue),
              // Only a line the owner revalued carries the approval.
              ...approvalColumns(stated.movingAverageValue === undefined ? undefined : revaluation),
            })

            await writeIdentity(tx, {
              tenantId: decoded.tenantId,
              warehouseId: decoded.warehouseId,
              source: movement.source,
              movementId: result.movementId,
              tracking: modes.tracking!.get(request.itemId) ?? "none",
              line: {
                itemId: request.itemId,
                quantity: request.quantity,
                identity: stated.identity,
              },
            })
            written.push({ ...request, movementId: result.movementId })
          }

          return written
        }, "inventory.opening_stock.write")

        return toOpeningLoad(legalEntityId, decoded, rows, journalEntryId)
      }),
      "inventory.opening_stock.load",
    )
  })

  const valuation = Effect.fn("StockKeepingService.valuation")(function* (
    input: Schema.Codec.Encoded<typeof ValuationReportInput>,
  ) {
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
    setItemTracking,
    lookupSerial,
    receiveValued,
    issueValued,
    countStock,
    loadOpeningStock,
    valuation,
  } satisfies StockKeepingService
})

export const StockKeepingLive = Layer.effect(StockKeepingService, makeStockKeepingService)
