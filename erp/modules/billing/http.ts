// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  FinancialMajorAmount,
  PositiveQuantity,
} from "../../../framework/foundation/mod.ts"
import {
  ApiErrors,
  BaseApiErrorPolicy,
  BearerAuth,
  CurrentPrincipal,
  ShortString,
  TenantHeaders,
  Uuid,
  apiErrorMapping,
  moduleApi,
} from "../../../framework/modules/http/mod.ts"
import { BillingDocument, BillingService, BillingSide, OpenItem } from "./mod.ts"

export const BillingHttpGroup = HttpApiGroup.make("Billing").add(
  HttpApiEndpoint.get("listBillingDocuments", "/billing/documents", {
    headers: TenantHeaders,
    query: {
      legalEntityId: Uuid,
      partyId: Schema.optionalKey(Uuid),
      side: Schema.optionalKey(BillingSide),
      to: Schema.optionalKey(CalendarDate),
    },
    success: Schema.Array(BillingDocument),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("getBillingDocument", "/billing/documents/:id", {
    params: { id: Uuid },
    headers: TenantHeaders,
    success: BillingDocument,
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listOpenItems", "/billing/open-items", {
    headers: TenantHeaders,
    query: {
      legalEntityId: Uuid,
      side: BillingSide,
      partyId: Schema.optionalKey(Uuid),
      asOf: CalendarDate,
    },
    success: Schema.Array(OpenItem),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("invoiceSalesOrder", "/billing/invoices", {
    headers: TenantHeaders,
    payload: Schema.Struct({
      orderId: Uuid,
      invoiceDate: CalendarDate,
      invoiceId: Schema.optionalKey(Uuid),
    }),
    success: BillingDocument.pipe(HttpApiSchema.status(201)),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("billPurchaseOrder", "/billing/supplier-bills", {
    headers: TenantHeaders,
    payload: Schema.Struct({
      billId: Schema.optionalKey(Uuid),
      purchaseOrderId: Uuid,
      billDate: CalendarDate,
      supplierReference: ShortString,
      lines: Schema.Array(
        Schema.Struct({
          purchaseOrderLineId: Uuid,
          quantity: PositiveQuantity,
          unitPrice: FinancialMajorAmount,
        }),
      ),
    }),
    success: BillingDocument.pipe(HttpApiSchema.status(201)),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("creditBillingDocument", "/billing/documents/:id/credit-notes", {
    params: { id: Uuid },
    headers: TenantHeaders,
    payload: Schema.Struct({
      creditNoteId: Schema.optionalKey(Uuid),
      creditDate: CalendarDate,
      lines: Schema.Array(Schema.Struct({ invoiceLineId: Uuid, quantity: PositiveQuantity })),
    }),
    success: BillingDocument.pipe(HttpApiSchema.status(201)),
    error: ApiErrors,
  }).middleware(BearerAuth),
)

const BillingHttpApi = moduleApi(BillingHttpGroup)

export const BillingHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  AccountNotFound: "not_found",
  AccountingLegalEntityNotFound: "not_found",
  AccountingPeriodNotOpen: "conflict",
  BillExceedsReceipt: "conflict",
  BillingDocumentNotFound: "not_found",
  CreditExceedsInvoice: "conflict",
  CustomerLegalEntityRequired: "conflict",
  FinancialEngineActivated: "conflict",
  InvalidJournalLine: "conflict",
  JournalIdempotencyConflict: "conflict",
  NothingToInvoice: "conflict",
  PartyRelationshipNotFound: "not_found",
  PostingRuleNotFound: "conflict",
  ProductNotFound: "not_found",
  PurchaseOrderInvalidState: "conflict",
  PurchaseOrderNotFound: "not_found",
  SalesOrderInvalidState: "conflict",
  SalesOrderNotFound: "not_found",
  SettlementConflict: "conflict",
  SettlementExceedsOpenAmount: "conflict",
  TaxCodeNotFound: "not_found",
  UnbalancedJournal: "conflict",
})

export const BillingHttpHandlers = HttpApiBuilder.group(BillingHttpApi, "Billing", (handlers) =>
  Effect.gen(function* () {
    const billing = yield* BillingService

    return handlers
      .handle(
        "listBillingDocuments",
        Effect.fn("Http.Billing.listBillingDocuments")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* BillingHttpErrors.apiEffect(
            billing.listDocuments({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "getBillingDocument",
        Effect.fn("Http.Billing.getBillingDocument")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal

          return yield* BillingHttpErrors.apiEffect(
            billing.getDocument({
              principal,
              tenantId: headers["x-tenant-id"],
              invoiceId: params.id,
            }),
          )
        }),
      )
      .handle(
        "listOpenItems",
        Effect.fn("Http.Billing.listOpenItems")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* BillingHttpErrors.apiEffect(
            billing.listOpenItems({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "invoiceSalesOrder",
        Effect.fn("Http.Billing.invoiceSalesOrder")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* BillingHttpErrors.apiEffect(
            billing.invoiceSalesOrder({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            }),
          )
        }),
      )
      .handle(
        "billPurchaseOrder",
        Effect.fn("Http.Billing.billPurchaseOrder")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* BillingHttpErrors.apiEffect(
            billing.billPurchaseOrder({
              principal,
              tenantId: headers["x-tenant-id"],
              ...payload,
            }),
          )
        }),
      )
      .handle(
        "creditBillingDocument",
        Effect.fn("Http.Billing.creditBillingDocument")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* BillingHttpErrors.apiEffect(
            billing.creditInvoice({
              principal,
              tenantId: headers["x-tenant-id"],
              invoiceId: params.id,
              ...payload,
            }),
          )
        }),
      )
  }),
)
