/**
 * Sales aggregates on the Alchemy domain-model port (ADR-0124, phase 1 class A). Test-only: not
 * exported from `mod.ts`, so production never loads Alchemy, and the tables stay authoritative.
 *
 * Each `decide` calls the function the production service calls, so the two cannot disagree:
 * `order-lifecycle.ts` (SAL-ORDER-1, SAL-ORDER-3), `quotation.ts` (SAL-QUOT-1, SAL-QUOT-2) and
 * `customer.ts` (SAL-CUST-2). Tenant scope and authorization run in the service before a command is
 * sent (phase 0), so no `decide` checks a capability and every instance id is built from the
 * caller's tenant. What a command needs from another module (a price list price, a tax default, a
 * Party relationship) is read by the service and arrives in the command.
 */
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { FinancialMajorAmount, PositiveQuantity } from "../../../../framework/foundation/mod.ts"
import { SalesOrderLine, SalesOrderStatus } from "./contract.ts"
import { decidePartyCustomer, PartyCustomerDecision } from "./customer.ts"
import { DiscountPercent } from "./documents-contract.ts"
import {
  ConfirmationDecision,
  decideCancellation,
  decideConfirmation,
  CancellationDecision,
  quotationBelongsToCustomer,
} from "./order-lifecycle.ts"
import {
  decideLinePricing,
  decideQuotationTransition,
  LinePricing,
  lineTotal,
  QuotationTransition,
  sumLineTotals,
} from "./quotation.ts"
import { deriveTotal } from "./store.ts"

const QuotationStatus = Schema.Literals(["draft", "sent", "accepted", "rejected", "expired"])

// ---------------------------------------------------------------- SalesOrder (SAL-ORDER-1, -3)

export const OrderId = Schema.String.pipe(Schema.brand("OrderId"))

export class SalesOrderNotFound extends Domain.Rejection("SalesOrderNotFound") {}

export class SalesOrderInvalidState extends Domain.Rejection("SalesOrderInvalidState", {
  status: SalesOrderStatus,
}) {}

export class SalesOrderConfirmationIdempotencyConflict extends Domain.Rejection(
  "SalesOrderConfirmationIdempotencyConflict",
) {}

export class QuotationCustomerMismatch extends Domain.Rejection("QuotationCustomerMismatch", {
  quotationId: Schema.String,
  customerId: Schema.String,
}) {}

const OrderLines = Schema.Array(SalesOrderLine).check(Schema.isMinLength(1))

export class OrderCreated extends Domain.Event("OrderCreated", {
  customerId: Schema.String,
  quotationId: Schema.NullOr(Schema.String),
  lines: OrderLines,
  total: Schema.String,
}) {}

export class CreateOrder extends Domain.Command("CreateOrder", {
  target: OrderId,
  input: {
    customerId: Schema.String,
    /** The quotation the service read, with the customer it belongs to. */
    quotation: Schema.optionalKey(Schema.Struct({ id: Schema.String, customerId: Schema.String })),
    lines: OrderLines,
  },
  events: [OrderCreated],
  rejects: [QuotationCustomerMismatch],
}) {}

export class OrderConfirmed extends Domain.Event("OrderConfirmed", {
  idempotencyKey: Schema.String,
}) {}

export class ConfirmOrder extends Domain.Command("ConfirmOrder", {
  target: OrderId,
  input: { idempotencyKey: Schema.String },
  events: [OrderConfirmed],
  rejects: [SalesOrderNotFound, SalesOrderInvalidState, SalesOrderConfirmationIdempotencyConflict],
}) {}

export class OrderCancelled extends Domain.Event("OrderCancelled", {}) {}

export class CancelOrder extends Domain.Command("CancelOrder", {
  target: OrderId,
  input: {},
  events: [OrderCancelled],
  rejects: [SalesOrderNotFound, SalesOrderInvalidState],
}) {}

const OrderBody = {
  customerId: Schema.String,
  quotationId: Schema.NullOr(Schema.String),
  lines: OrderLines,
  total: Schema.String,
}

export const AbsentOrder = Schema.TaggedStruct("Absent", {})
export const DraftOrder = Schema.TaggedStruct("Draft", OrderBody)

/** Confirmation metadata survives cancellation, as PostgreSQL keeps it. */
export const ConfirmedOrder = Schema.TaggedStruct("Confirmed", {
  ...OrderBody,
  confirmationIdempotencyKey: Schema.String,
})

export const CancelledOrder = Schema.TaggedStruct("Cancelled", {
  ...OrderBody,
  confirmationIdempotencyKey: Schema.String,
})

const OrderState = Schema.Union([AbsentOrder, DraftOrder, ConfirmedOrder, CancelledOrder])

type OrderState = typeof OrderState.Type

/** The shape `order-lifecycle.ts` decides on; undefined for an order that does not exist. */
const lifecycleOf = (order: OrderState) =>
  Match.value(order).pipe(
    Match.tag("Draft", () => ({ status: "draft", confirmationIdempotencyKey: null }) as const),
    Match.tag(
      "Confirmed",
      ({ confirmationIdempotencyKey }) =>
        ({ status: "confirmed", confirmationIdempotencyKey }) as const,
    ),
    Match.tag(
      "Cancelled",
      ({ confirmationIdempotencyKey }) =>
        ({ status: "cancelled", confirmationIdempotencyKey }) as const,
    ),
    Match.orElse(() => undefined),
  )

export class SalesOrder extends Domain.Aggregate("SalesOrder", {
  id: OrderId,
  state: OrderState,
  initial: AbsentOrder.make({}),
  commands: [CreateOrder, ConfirmOrder, CancelOrder],
  decide: {
    // The id is generated by the service, so creating an existing instance cannot happen; it is a
    // no-op rather than a second creation.
    CreateOrder: (order, cmd) => {
      if (!Predicate.isTagged(order, "Absent")) return []

      if (
        cmd.quotation !== undefined &&
        !quotationBelongsToCustomer(cmd.quotation, cmd.customerId)
      ) {
        return new QuotationCustomerMismatch({
          quotationId: cmd.quotation.id,
          customerId: cmd.customerId,
        })
      }

      return [
        new OrderCreated({
          customerId: cmd.customerId,
          quotationId: cmd.quotation?.id ?? null,
          lines: cmd.lines,
          total: deriveTotal(cmd.lines),
        }),
      ]
    },
    ConfirmOrder: (order, cmd) => {
      const lifecycle = lifecycleOf(order)

      if (lifecycle === undefined) return new SalesOrderNotFound()

      return ConfirmationDecision.$match(decideConfirmation(lifecycle, cmd.idempotencyKey), {
        Confirm: () => [new OrderConfirmed({ idempotencyKey: cmd.idempotencyKey })],
        Existing: () => [],
        IdempotencyConflict: () => new SalesOrderConfirmationIdempotencyConflict(),
        InvalidState: ({ status }) => new SalesOrderInvalidState({ status }),
      })
    },
    CancelOrder: (order) => {
      const lifecycle = lifecycleOf(order)

      if (lifecycle === undefined) return new SalesOrderNotFound()

      return CancellationDecision.$match(decideCancellation(lifecycle.status), {
        Cancel: () => [new OrderCancelled()],
        AlreadyCancelled: () => [],
        InvalidState: ({ status }) => new SalesOrderInvalidState({ status }),
      })
    },
  },
  evolve: {
    OrderCreated: (_, e): OrderState =>
      DraftOrder.make({
        customerId: e.customerId,
        quotationId: e.quotationId,
        lines: e.lines,
        total: e.total,
      }),
    OrderConfirmed: (s, e): OrderState =>
      Predicate.isTagged(s, "Draft")
        ? ConfirmedOrder.make({
            customerId: s.customerId,
            quotationId: s.quotationId,
            lines: s.lines,
            total: s.total,
            confirmationIdempotencyKey: e.idempotencyKey,
          })
        : s,
    OrderCancelled: (s): OrderState =>
      Predicate.isTagged(s, "Confirmed")
        ? CancelledOrder.make({
            customerId: s.customerId,
            quotationId: s.quotationId,
            lines: s.lines,
            total: s.total,
            confirmationIdempotencyKey: s.confirmationIdempotencyKey,
          })
        : s,
  },
}) {}

// ---------------------------------------------------------------- Quotation (SAL-QUOT-1, -2)

export const QuotationId = Schema.String.pipe(Schema.brand("QuotationId"))

export class QuotationNotFound extends Domain.Rejection("QuotationNotFound") {}

export class QuotationInvalidState extends Domain.Rejection("QuotationInvalidState", {
  status: QuotationStatus,
}) {}

export class ProductPriceNotFound extends Domain.Rejection("ProductPriceNotFound", {
  productId: Schema.String,
}) {}

const PricedQuotationLine = Schema.Struct({
  productId: Schema.String,
  quantity: Schema.String,
  listPrice: Schema.String,
  discountPercent: Schema.String,
  unitPrice: Schema.String,
  taxCodeId: Schema.NullOr(Schema.String),
  lineTotal: Schema.String,
})

export class QuotationDrafted extends Domain.Event("QuotationDrafted", {
  customerId: Schema.String,
  legalEntityId: Schema.String,
  validUntil: Schema.String,
  lines: Schema.Array(PricedQuotationLine),
  total: Schema.String,
}) {}

export class DraftQuotation extends Domain.Command("DraftQuotation", {
  target: QuotationId,
  input: {
    customerId: Schema.String,
    legalEntityId: Schema.String,
    validUntil: Schema.String,
    lines: Schema.Array(
      Schema.Struct({
        productId: Schema.String,
        quantity: PositiveQuantity,
        /** Overrides the customer's price list. */
        listPrice: Schema.optionalKey(FinancialMajorAmount),
        /** What the customer's price list holds for the product, as the service read it. */
        priceListPrice: Schema.optionalKey(FinancialMajorAmount),
        discountPercent: Schema.optionalKey(DiscountPercent),
        /** Overrides the product's default sales tax code. */
        taxCodeId: Schema.optionalKey(Schema.NullOr(Schema.String)),
        /** The default Tax chose for the product in the sales direction. */
        defaultTaxCodeId: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    ).check(Schema.isMinLength(1)),
  },
  events: [QuotationDrafted],
  rejects: [ProductPriceNotFound],
}) {}

export class QuotationSent extends Domain.Event("QuotationSent", {}) {}

export class SendQuotation extends Domain.Command("SendQuotation", {
  target: QuotationId,
  input: {},
  events: [QuotationSent],
  rejects: [QuotationNotFound, QuotationInvalidState],
}) {}

export class QuotationAccepted extends Domain.Event("QuotationAccepted", {}) {}

export class AcceptQuotation extends Domain.Command("AcceptQuotation", {
  target: QuotationId,
  input: {},
  events: [QuotationAccepted],
  rejects: [QuotationNotFound, QuotationInvalidState],
}) {}

export class QuotationRejected extends Domain.Event("QuotationRejected", {}) {}

export class RejectQuotation extends Domain.Command("RejectQuotation", {
  target: QuotationId,
  input: {},
  events: [QuotationRejected],
  rejects: [QuotationNotFound, QuotationInvalidState],
}) {}

export class QuotationExpired extends Domain.Event("QuotationExpired", {}) {}

/** One quotation's share of the `expireQuotations` sweep; never refuses. */
export class ExpireQuotation extends Domain.Command("ExpireQuotation", {
  target: QuotationId,
  input: { asOf: Schema.String },
  events: [QuotationExpired],
}) {}

export const AbsentQuotation = Schema.TaggedStruct("Absent", {})

export const OpenQuotation = Schema.TaggedStruct("Quotation", {
  status: QuotationStatus,
  customerId: Schema.String,
  validUntil: Schema.String,
  lines: Schema.Array(PricedQuotationLine),
  total: Schema.String,
})

const QuotationState = Schema.Union([AbsentQuotation, OpenQuotation])

type QuotationState = typeof QuotationState.Type

const move = <E>(
  quotation: QuotationState,
  from: typeof QuotationStatus.Type,
  to: typeof QuotationStatus.Type,
  event: () => E,
) => {
  if (!Predicate.isTagged(quotation, "Quotation")) return new QuotationNotFound()

  return QuotationTransition.$match(decideQuotationTransition(quotation.status, from, to), {
    Move: () => [event()],
    Unchanged: () => [],
    InvalidState: ({ status }) => new QuotationInvalidState({ status }),
  })
}

const withStatus = (
  quotation: QuotationState,
  status: typeof QuotationStatus.Type,
): QuotationState =>
  Predicate.isTagged(quotation, "Quotation") ? { ...quotation, status } : quotation

export class Quotation extends Domain.Aggregate("Quotation", {
  id: QuotationId,
  state: QuotationState,
  initial: AbsentQuotation.make({}),
  commands: [DraftQuotation, SendQuotation, AcceptQuotation, RejectQuotation, ExpireQuotation],
  decide: {
    // Like `CreateOrder`: the service generates the id, so a second draft is a no-op.
    DraftQuotation: (quotation, cmd) => {
      if (!Predicate.isTagged(quotation, "Absent")) return []

      const lines = []

      for (const line of cmd.lines) {
        const pricing = decideLinePricing(line, line.priceListPrice, line.defaultTaxCodeId)

        if (LinePricing.$is("PriceNotFound")(pricing)) {
          return new ProductPriceNotFound({ productId: line.productId })
        }

        lines.push({
          productId: line.productId,
          quantity: line.quantity,
          listPrice: pricing.listPrice,
          discountPercent: pricing.discountPercent,
          unitPrice: pricing.unitPrice,
          taxCodeId: pricing.taxCodeId,
          lineTotal: lineTotal(pricing.unitPrice, line.quantity),
        })
      }

      return [
        new QuotationDrafted({
          customerId: cmd.customerId,
          legalEntityId: cmd.legalEntityId,
          validUntil: cmd.validUntil,
          lines,
          total: sumLineTotals(lines.map((line) => line.lineTotal)),
        }),
      ]
    },
    SendQuotation: (quotation) => move(quotation, "draft", "sent", () => new QuotationSent()),
    AcceptQuotation: (quotation) =>
      move(quotation, "sent", "accepted", () => new QuotationAccepted()),
    RejectQuotation: (quotation) =>
      move(quotation, "sent", "rejected", () => new QuotationRejected()),
    // Mirrors the sweep's SQL predicate (`status = 'sent' and valid_until < asOf`), which no
    // production decision function shares: calendar dates compare as ISO strings. Drafts and
    // decided quotations are left alone, not refused.
    ExpireQuotation: (quotation, cmd) =>
      Predicate.isTagged(quotation, "Quotation") &&
      quotation.status === "sent" &&
      quotation.validUntil < cmd.asOf
        ? [new QuotationExpired()]
        : [],
  },
  evolve: {
    QuotationDrafted: (_, e): QuotationState =>
      OpenQuotation.make({
        status: "draft",
        customerId: e.customerId,
        validUntil: e.validUntil,
        lines: e.lines,
        total: e.total,
      }),
    QuotationSent: (s) => withStatus(s, "sent"),
    QuotationAccepted: (s) => withStatus(s, "accepted"),
    QuotationRejected: (s) => withStatus(s, "rejected"),
    QuotationExpired: (s) => withStatus(s, "expired"),
  },
}) {}

// ---------------------------------------------------------------- PartyCustomer (SAL-CUST-2)

/** A customer is created once per Party relationship, so the relationship is the instance id. */
export const PartyRelationshipId = Schema.String.pipe(Schema.brand("PartyRelationshipId"))

export class CustomerPartyRoleInvalid extends Domain.Rejection("CustomerPartyRoleInvalid") {}

export class PartyCustomerCreated extends Domain.Event("PartyCustomerCreated", {
  partyId: Schema.String,
  legalEntityId: Schema.String,
  name: Schema.String,
  email: Schema.String,
}) {}

export class CreatePartyCustomer extends Domain.Command("CreatePartyCustomer", {
  target: PartyRelationshipId,
  input: {
    /** The Party relationship the service read. */
    relationship: Schema.Struct({ kind: Schema.String, active: Schema.Boolean }),
    partyId: Schema.String,
    legalEntityId: Schema.String,
    /** The Party's name. */
    name: Schema.String,
    email: Schema.String,
  },
  events: [PartyCustomerCreated],
  rejects: [CustomerPartyRoleInvalid],
}) {}

export const NoCustomer = Schema.TaggedStruct("None", {})

export const CustomerOfRelationship = Schema.TaggedStruct("Customer", {
  partyId: Schema.String,
  legalEntityId: Schema.String,
  name: Schema.String,
  email: Schema.String,
})

const PartyCustomerState = Schema.Union([NoCustomer, CustomerOfRelationship])

export class PartyCustomer extends Domain.Aggregate("PartyCustomer", {
  id: PartyRelationshipId,
  state: PartyCustomerState,
  initial: NoCustomer.make({}),
  commands: [CreatePartyCustomer],
  decide: {
    CreatePartyCustomer: (customer, cmd) =>
      PartyCustomerDecision.$match(
        decidePartyCustomer(cmd.relationship, !Predicate.isTagged(customer, "None")),
        {
          Create: () => [
            new PartyCustomerCreated({
              partyId: cmd.partyId,
              legalEntityId: cmd.legalEntityId,
              name: cmd.name,
              email: cmd.email.trim().toLowerCase(),
            }),
          ],
          Existing: () => [],
          InvalidRole: () => new CustomerPartyRoleInvalid(),
        },
      ),
  },
  evolve: {
    PartyCustomerCreated: (_, e) =>
      CustomerOfRelationship.make({
        partyId: e.partyId,
        legalEntityId: e.legalEntityId,
        name: e.name,
        email: e.email,
      }),
  },
}) {}

// ---------------------------------------------------------------- Model

export class Sales extends Domain.Model("Sales", {
  aggregates: [SalesOrder, Quotation, PartyCustomer],
}) {}
