import { and, eq, inArray, sql } from "drizzle-orm"

import {
  items,
  lotBalances,
  lotMovements,
  lots,
  serialUnits,
} from "../../../../db/schema/inventory.ts"
import type { DrizzleTransaction } from "../../../../framework/foundation/mod.ts"
import type { StockIdentity } from "./stock-keeping-contract.ts"

export type Tracking = "none" | "lot" | "serial"

/** Why a tracked line cannot move; the caller turns each into its typed error (ADR-0131). */
export type IdentityProblem =
  | { readonly kind: "required"; readonly itemId: string; readonly tracking: "lot" | "serial" }
  | { readonly kind: "invalid"; readonly itemId: string; readonly reason: string }
  | { readonly kind: "unavailable"; readonly itemId: string; readonly identity: string }

const invalidIdentity = (itemId: string, reason: string): IdentityProblem => ({
  kind: "invalid",
  itemId,
  reason,
})

const lotMismatch = (
  itemId: string,
  units: bigint,
  identity: StockIdentity,
): IdentityProblem | undefined => {
  if (identity.serials !== undefined) {
    return invalidIdentity(itemId, "a lot item takes lots, not serials")
  }

  const given = identity.lots ?? []

  if (given.length === 0) return { kind: "required", itemId, tracking: "lot" }

  if (new Set(given.map((lot) => lot.code)).size !== given.length) {
    return invalidIdentity(itemId, "a lot appears once per line")
  }

  return given.reduce((sum, lot) => sum + BigInt(lot.quantity), 0n) === units
    ? undefined
    : invalidIdentity(itemId, "the lot quantities do not add up to the line quantity")
}

const serialMismatch = (
  itemId: string,
  units: bigint,
  identity: StockIdentity,
): IdentityProblem | undefined => {
  if (identity.lots !== undefined) {
    return invalidIdentity(itemId, "a serial item takes serials, not lots")
  }

  const serials = identity.serials ?? []

  if (serials.length === 0) return { kind: "required", itemId, tracking: "serial" }

  if (new Set(serials).size !== serials.length) {
    return invalidIdentity(itemId, "a serial appears once per line")
  }

  return BigInt(serials.length) === units
    ? undefined
    : invalidIdentity(itemId, "the number of serials is not the line quantity")
}

/**
 * Whether the identity given fits the item's tracking mode and the line's quantity: the right kind,
 * no repeats, and as many units as the quantity. It looks at nothing but the line.
 */
export const identityMismatch = (
  itemId: string,
  tracking: Tracking,
  quantity: bigint,
  identity: StockIdentity | undefined,
): IdentityProblem | undefined => {
  const units = quantity < 0n ? -quantity : quantity

  if (tracking === "none") {
    return identity === undefined ? undefined : invalidIdentity(itemId, "the item is not tracked")
  }

  if (identity === undefined) return { kind: "required", itemId, tracking }

  return tracking === "lot"
    ? lotMismatch(itemId, units, identity)
    : serialMismatch(itemId, units, identity)
}

/** The tracking mode of each of these items. */
export const trackingOf = async (
  tx: DrizzleTransaction,
  tenantId: string,
  itemIds: ReadonlyArray<string>,
) => {
  const rows = await tx
    .select({ id: items.id, tracking: items.tracking })
    .from(items)
    .where(and(eq(items.tenantId, tenantId), inArray(items.id, [...itemIds])))

  return new Map(rows.map((row) => [row.id, row.tracking]))
}

type Line = {
  readonly itemId: string
  readonly quantity: bigint
  readonly identity: StockIdentity | undefined
}

const unavailableIdentity = (itemId: string, identity: string): IdentityProblem => ({
  kind: "unavailable",
  itemId,
  identity,
})

/** Serials to issue are in stock in the warehouse; serials to receive are not in stock anywhere. */
const serialAvailability = async (
  tx: DrizzleTransaction,
  tenantId: string,
  warehouseId: string,
  line: Line,
): Promise<IdentityProblem | undefined> => {
  const serials = line.identity?.serials ?? []

  const found = await tx
    .select()
    .from(serialUnits)
    .where(
      and(
        eq(serialUnits.tenantId, tenantId),
        eq(serialUnits.itemId, line.itemId),
        inArray(serialUnits.serial, [...serials]),
      ),
    )

  const byCode = new Map(found.map((unit) => [unit.serial, unit]))

  const misfit = serials.find((serial) => {
    const unit = byCode.get(serial)

    return line.quantity > 0n
      ? unit !== undefined && unit.status === "in_stock"
      : unit === undefined || unit.status !== "in_stock" || unit.warehouseId !== warehouseId
  })

  return misfit === undefined ? undefined : unavailableIdentity(line.itemId, misfit)
}

/** Each lot to issue holds enough in the warehouse, read under the balance lock. */
const lotAvailability = async (
  tx: DrizzleTransaction,
  tenantId: string,
  warehouseId: string,
  line: Line,
): Promise<IdentityProblem | undefined> => {
  for (const lot of line.identity?.lots ?? []) {
    const held = (
      await tx
        .select({ onHand: lotBalances.onHand })
        .from(lotBalances)
        .innerJoin(
          lots,
          and(eq(lots.tenantId, lotBalances.tenantId), eq(lots.id, lotBalances.lotId)),
        )
        .where(
          and(
            eq(lotBalances.tenantId, tenantId),
            eq(lotBalances.warehouseId, warehouseId),
            eq(lots.itemId, line.itemId),
            eq(lots.code, lot.code),
          ),
        )
        .for("update")
    )[0]

    if (held === undefined || BigInt(held.onHand) < BigInt(lot.quantity)) {
      return unavailableIdentity(line.itemId, lot.code)
    }
  }

  return undefined
}

/**
 * Whether the stock is there to move by identity, under the balance locks the move holds: serials
 * to issue are in stock in the warehouse, serials to receive are not in stock anywhere, and each
 * lot to issue holds enough here.
 */
export const availabilityProblem = async (
  tx: DrizzleTransaction,
  tenantId: string,
  warehouseId: string,
  tracking: Tracking,
  line: Line,
): Promise<IdentityProblem | undefined> => {
  if (tracking === "serial") return serialAvailability(tx, tenantId, warehouseId, line)

  return tracking === "lot" && line.quantity < 0n
    ? lotAvailability(tx, tenantId, warehouseId, line)
    : undefined
}

type Written = {
  readonly tenantId: string
  readonly warehouseId: string
  readonly source: { readonly type: string; readonly id: string }
  readonly movementId: string
  readonly line: Line
}

/** Receives or issues each lot of a line: balance and lot movement, creating a new lot on receipt. */
const writeLots = async (tx: DrizzleTransaction, written: Written) => {
  const { tenantId, warehouseId, movementId, line } = written
  const received = line.quantity > 0n

  for (const lot of line.identity?.lots ?? []) {
    await tx
      .insert(lots)
      .values({ tenantId, itemId: line.itemId, code: lot.code, expiryDate: lot.expiry ?? null })
      .onConflictDoNothing()

    const row = (
      await tx
        .select({ id: lots.id })
        .from(lots)
        .where(
          and(eq(lots.tenantId, tenantId), eq(lots.itemId, line.itemId), eq(lots.code, lot.code)),
        )
    )[0]!

    const signed = ((received ? 1n : -1n) * BigInt(lot.quantity)).toString()
    const change = sql`${lotBalances.onHand} + ${signed}`

    if (received) {
      await tx
        .insert(lotBalances)
        .values({ tenantId, warehouseId, lotId: row.id, onHand: signed })
        .onConflictDoUpdate({
          target: [lotBalances.tenantId, lotBalances.warehouseId, lotBalances.lotId],
          set: { onHand: change, updatedAt: new Date() },
        })
    } else {
      // The row exists and was checked for enough stock under the balance lock.
      await tx
        .update(lotBalances)
        .set({ onHand: change, updatedAt: new Date() })
        .where(
          and(
            eq(lotBalances.tenantId, tenantId),
            eq(lotBalances.warehouseId, warehouseId),
            eq(lotBalances.lotId, row.id),
          ),
        )
    }

    await tx.insert(lotMovements).values({ tenantId, movementId, lotId: row.id, quantity: signed })
  }
}

/** Puts each serial in stock on receipt, or marks it issued (or returned to the supplier). */
const writeSerials = async (tx: DrizzleTransaction, written: Written) => {
  const { tenantId, warehouseId, source, line } = written
  const now = new Date()

  for (const serial of line.identity?.serials ?? []) {
    if (line.quantity > 0n) {
      const state = {
        status: "in_stock" as const,
        warehouseId,
        receivedSourceType: source.type,
        receivedSourceId: source.id,
        issuedSourceType: null,
        issuedSourceId: null,
        issuedAt: null,
      }

      await tx
        .insert(serialUnits)
        .values({ tenantId, itemId: line.itemId, serial, ...state })
        .onConflictDoUpdate({
          target: [serialUnits.tenantId, serialUnits.itemId, serialUnits.serial],
          set: { ...state, updatedAt: now },
        })
    } else {
      await tx
        .update(serialUnits)
        .set({
          status: source.type === "procurement.return" ? "returned_to_supplier" : "issued",
          warehouseId: null,
          issuedSourceType: source.type,
          issuedSourceId: source.id,
          issuedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(serialUnits.tenantId, tenantId),
            eq(serialUnits.itemId, line.itemId),
            eq(serialUnits.serial, serial),
          ),
        )
    }
  }
}

/** Records what a written movement moved by identity: lot balances, or the state of each serial. */
export const writeIdentity = async (
  tx: DrizzleTransaction,
  args: Written & { readonly tracking: Tracking },
) => {
  if (args.tracking === "lot") await writeLots(tx, args)

  if (args.tracking === "serial") await writeSerials(tx, args)
}
