import type { DocumentNode, DocumentNodeType } from "./contract.ts"

/** A node before the requested document is marked. */
export type FlowNode = Omit<DocumentNode, "current">

/** Position of each document type in its chain; receivable and payable chains never mix. */
const stages: Readonly<Record<DocumentNodeType, number>> = {
  "sales.quotation": 0,
  "sales.order": 1,
  "sales.delivery": 2,
  "billing.customer_invoice": 3,
  "billing.customer_credit_note": 4,
  "procurement.purchase_order": 0,
  "procurement.receipt": 1,
  "billing.supplier_bill": 2,
  "billing.supplier_credit_note": 3,
  "settlement.payment": 5,
}

const isZero = (amount: string): boolean => /^-?0+(\.0*)?$/.test(amount)

/** A billing document is settled once nothing is left open on it. */
export const billingState = (
  type: DocumentNodeType,
  openAmount: string,
): "open" | "settled" | "applied" =>
  isZero(openAmount) ? (type.endsWith("credit_note") ? "applied" : "settled") : "open"

const dateOnly = (value: string | null): string | null =>
  value === null ? null : value.slice(0, 10)

export const instantDate = dateOnly

/**
 * Orders the nodes of one chain by stage, then date, then number, drops repeats of the same
 * document, and marks the requested one.
 */
export const arrangeChain = (
  nodes: ReadonlyArray<FlowNode>,
  currentId: string,
): ReadonlyArray<DocumentNode> => {
  const unique = new Map<string, FlowNode>()

  for (const node of nodes) unique.set(`${node.type}:${node.id}`, node)

  return Array.from(unique.values())
    .toSorted(
      (left, right) =>
        stages[left.type] - stages[right.type] ||
        (left.date ?? "").localeCompare(right.date ?? "") ||
        (left.number ?? left.id).localeCompare(right.number ?? right.id),
    )
    .map((node) => ({ ...node, current: node.id === currentId }))
}
