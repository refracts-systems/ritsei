import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  type ReplicaConsistencyFailure,
  TrimmedText,
  Uuid,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { EventIdempotencyConflict } from "../../../../framework/modules/messaging/mod.ts"
import type { DocumentNotFound } from "./errors.ts"

/** The documents a chain can start from. A billing document may be any invoice, credit note, or bill. */
export const FlowEntryType = Schema.Literals([
  "sales.quotation",
  "sales.order",
  "billing.document",
  "procurement.purchase_order",
])

export type FlowEntryType = Schema.Schema.Type<typeof FlowEntryType>

export const DocumentNodeType = Schema.Literals([
  "sales.quotation",
  "sales.order",
  "sales.delivery",
  "billing.customer_invoice",
  "billing.customer_credit_note",
  "settlement.payment",
  "procurement.purchase_order",
  "procurement.receipt",
  "procurement.return",
  "billing.supplier_bill",
  "billing.supplier_credit_note",
])

export type DocumentNodeType = Schema.Schema.Type<typeof DocumentNodeType>

export const ChainInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  documentType: FlowEntryType,
  documentId: Uuid,
})

/** One document in a chain; `current` marks the document the chain was requested for. */
export const DocumentNode = Schema.Struct({
  type: DocumentNodeType,
  id: Uuid,
  number: Schema.NullOr(Schema.String),
  state: Schema.String,
  amount: Schema.NullOr(Schema.String),
  date: Schema.NullOr(Schema.String),
  current: Schema.Boolean,
})

export type DocumentNode = Schema.Schema.Type<typeof DocumentNode>

/** Upstream and downstream documents in document order: earlier stages first, then by date. */
export const DocumentChain = Schema.Struct({
  /** The legal entity the billing documents of this chain belong to, when it has one. */
  legalEntityId: Schema.NullOr(Uuid),
  nodes: Schema.Array(DocumentNode),
})

export type DocumentChain = Schema.Schema.Type<typeof DocumentChain>

export const SerialLookupInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  serial: Schema.String.check(
    Schema.makeFilter(
      (value) => value === value.trim() && value.length >= 1 && value.length <= 64,
      {
        expected: "a trimmed serial of 1 to 64 characters",
      },
    ),
  ),
})

/**
 * Where a serial went: its item, its state, and, for a unit issued by a delivery, that delivery and
 * its customer. `delivery` is "denied" when Sales would not show the caller the delivery.
 */
export const SerialTrace = Schema.Struct({
  itemId: Uuid,
  serial: Schema.String,
  status: Schema.Literals(["in_stock", "issued", "returned_to_supplier"]),
  warehouseId: Schema.NullOr(Uuid),
  issuedBy: Schema.NullOr(Schema.Struct({ type: Schema.String, id: Uuid })),
  delivery: Schema.Literals(["none", "shown", "denied"]),
  deliveryNumber: Schema.NullOr(Schema.String),
  deliveryDate: Schema.NullOr(CalendarDate),
  customerId: Schema.NullOr(Uuid),
  customerName: Schema.NullOr(Schema.String),
})

export type SerialTrace = Schema.Schema.Type<typeof SerialTrace>

export const PipelineInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  legalEntityId: Uuid,
})

/** The stages of Order-to-Cash, then of Procure-to-Pay, as the Yard shows them. */
export const ReceivableStage = Schema.Literals([
  "quotation",
  "order",
  "delivered",
  "invoiced",
  "paid",
])

export const PayableStage = Schema.Literals(["ordered", "received", "billed", "paid"])

/** How many documents are at a stage, and the date of the oldest one (not the age: the reader dates it). */
export const PipelineStage = Schema.Struct({
  stage: Schema.Union([ReceivableStage, PayableStage]),
  count: Schema.Int,
  oldestDate: Schema.NullOr(CalendarDate),
})

export type PipelineStage = Schema.Schema.Type<typeof PipelineStage>

export const Pipeline = Schema.Struct({
  legalEntityId: Uuid,
  receivable: Schema.Array(PipelineStage),
  payable: Schema.Array(PipelineStage),
})

export type Pipeline = Schema.Schema.Type<typeof Pipeline>

export const LookupInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  number: TrimmedText(64),
})

/**
 * A document with exactly the number asked for. It says where to open the document, not that the
 * caller may: opening it is authorized again by the module that owns it.
 */
export const LookupCandidate = Schema.Struct({
  type: DocumentNodeType,
  id: Uuid,
  number: Schema.String,
  legalEntityId: Uuid,
})

export type LookupCandidate = Schema.Schema.Type<typeof LookupCandidate>

export const Lookup = Schema.Struct({ candidates: Schema.Array(LookupCandidate) })

export type Lookup = Schema.Schema.Type<typeof Lookup>

export type CommonFailure =
  | AuthorizationDenied
  | DatabaseFailure
  | EventIdempotencyConflict
  | ReplicaConsistencyFailure
  | Schema.SchemaError

/**
 * Read port over the document chains of Order-to-Cash and Procure-to-Pay (ADR-0107). It joins what
 * the owning modules already expose; every read is authorized by the module that owns the document.
 */
export interface DocumentsService {
  /** Where a serial went, for a warranty claim: item, state, delivery, and customer. */
  readonly serialLookup: (
    input: Schema.Codec.Encoded<typeof SerialLookupInput>,
  ) => Effect.Effect<ReadonlyArray<SerialTrace>, CommonFailure>
  readonly chain: (
    input: Schema.Codec.Encoded<typeof ChainInput>,
  ) => Effect.Effect<DocumentChain, DocumentNotFound | CommonFailure>
  /**
   * The documents of the caller's tenant whose number is exactly this, from every owner the caller
   * may read. An owner the caller may not read adds nothing; a caller who may read none is denied.
   */
  readonly lookup: (
    input: Schema.Codec.Encoded<typeof LookupInput>,
  ) => Effect.Effect<Lookup, CommonFailure>
  /** Counts and the oldest document date per stage for one legal entity, read once per owner. */
  readonly pipeline: (
    input: Schema.Codec.Encoded<typeof PipelineInput>,
  ) => Effect.Effect<Pipeline, CommonFailure>
}

export const DocumentsService = Context.Service<DocumentsService>("RITSEI/DocumentsService")
