import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  type ReplicaConsistencyFailure,
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

type CommonFailure =
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
  readonly chain: (
    input: Schema.Codec.Encoded<typeof ChainInput>,
  ) => Effect.Effect<DocumentChain, DocumentNotFound | CommonFailure>
  /** Counts and the oldest document date per stage for one legal entity, read once per owner. */
  readonly pipeline: (
    input: Schema.Codec.Encoded<typeof PipelineInput>,
  ) => Effect.Effect<Pipeline, CommonFailure>
}

export const DocumentsService = Context.Service<DocumentsService>("RITSEI/DocumentsService")
