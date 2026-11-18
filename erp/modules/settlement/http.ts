// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as Schema from "effect/Schema"

import { CalendarDate, FinancialMajorAmount } from "../../../framework/foundation/mod.ts"
import {
  ApiErrors,
  BaseApiErrorPolicy,
  BearerAuth,
  CurrentPrincipal,
  ReadLimit,
  TenantHeaders,
  Uuid,
  apiErrorMapping,
  moduleApi,
} from "../../../framework/modules/http/mod.ts"
import {
  AgingReport,
  Allocation,
  BankLineMatch,
  BankReconciliation,
  BankStatement,
  CustomerStatement,
  Payment,
  PaymentDirection,
  SettlementService,
  SettlementSide,
  Withholding,
} from "./mod.ts"

const PaymentFields = {
  paymentId: Schema.optionalKey(Uuid),
  legalEntityId: Uuid,
  partyId: Uuid,
  paymentDate: CalendarDate,
  amount: FinancialMajorAmount,
  cashAccountId: Schema.optionalKey(Uuid),
  allocations: Schema.Array(Allocation),
}

const PaymentPayload = Schema.Struct(PaymentFields)

const ReceiptPayload = Schema.Struct({
  ...PaymentFields,
  withholding: Schema.optionalKey(Withholding),
})

export const SettlementHttpGroup = HttpApiGroup.make("Settlement").add(
  HttpApiEndpoint.post("receivePayment", "/settlement/receipts", {
    headers: TenantHeaders,
    payload: ReceiptPayload,
    success: Payment.pipe(HttpApiSchema.status(201)),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("makePayment", "/settlement/payments", {
    headers: TenantHeaders,
    payload: PaymentPayload,
    success: Payment.pipe(HttpApiSchema.status(201)),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("allocatePayment", "/settlement/payments/:id/allocations", {
    params: { id: Uuid },
    headers: TenantHeaders,
    payload: Schema.Struct({
      allocatedOn: CalendarDate,
      allocations: Schema.Array(Allocation),
    }),
    success: Payment,
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listPayments", "/settlement/payments", {
    headers: TenantHeaders,
    query: {
      legalEntityId: Uuid,
      direction: Schema.optionalKey(PaymentDirection),
      partyId: Schema.optionalKey(Uuid),
      limit: ReadLimit,
    },
    success: Schema.Array(Payment),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("agingReport", "/settlement/aging", {
    headers: TenantHeaders,
    query: { legalEntityId: Uuid, side: SettlementSide, asOf: CalendarDate },
    success: AgingReport,
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("customerStatement", "/settlement/statements", {
    headers: TenantHeaders,
    query: { legalEntityId: Uuid, partyId: Uuid, from: CalendarDate, to: CalendarDate },
    success: CustomerStatement,
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("importBankStatement", "/settlement/bank-statements", {
    headers: TenantHeaders,
    payload: Schema.Struct({
      legalEntityId: Uuid,
      bankAccountId: Uuid,
      sourceName: Schema.String,
      content: Schema.String,
    }),
    success: BankStatement.pipe(HttpApiSchema.status(201)),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("matchBankLine", "/settlement/bank-matches", {
    headers: TenantHeaders,
    payload: Schema.Struct({
      matchId: Schema.optionalKey(Uuid),
      lineId: Uuid,
      paymentId: Uuid,
      amount: FinancialMajorAmount,
    }),
    success: BankLineMatch.pipe(HttpApiSchema.status(201)),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("reverseBankMatch", "/settlement/bank-matches/:id/reversal", {
    params: { id: Uuid },
    headers: TenantHeaders,
    success: BankLineMatch,
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("bankReconciliation", "/settlement/bank-reconciliation", {
    headers: TenantHeaders,
    query: { legalEntityId: Uuid, bankAccountId: Uuid, limit: ReadLimit },
    success: BankReconciliation,
    error: ApiErrors,
  }).middleware(BearerAuth),
)

const SettlementHttpApi = moduleApi(SettlementHttpGroup)

export const SettlementHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  AccountNotFound: "not_found",
  AccountingLegalEntityNotFound: "not_found",
  AccountingPeriodNotOpen: "conflict",
  AllocationBeforePayment: "conflict",
  AllocationExceedsPayment: "conflict",
  AllocationMismatch: "conflict",
  BankLineNotFound: "not_found",
  BankMatchExceedsAvailable: "conflict",
  BankMatchMismatch: "conflict",
  BankMatchNotFound: "not_found",
  BillingDocumentNotFound: "not_found",
  FinancialEngineActivated: "conflict",
  InvalidBankStatement: "invalid_request",
  InvalidJournalLine: "conflict",
  InvalidWithholding: "conflict",
  JournalIdempotencyConflict: "conflict",
  PaymentNotFound: "not_found",
  PostingRuleNotFound: "conflict",
  SettlementConflict: "conflict",
  SettlementExceedsOpenAmount: "conflict",
  UnbalancedJournal: "conflict",
})

export const SettlementHttpHandlers = HttpApiBuilder.group(
  SettlementHttpApi,
  "Settlement",
  (handlers) =>
    Effect.gen(function* () {
      const settlement = yield* SettlementService

      return handlers
        .handle(
          "receivePayment",
          Effect.fn("Http.Settlement.receivePayment")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* SettlementHttpErrors.apiEffect(
              settlement.receivePayment({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "makePayment",
          Effect.fn("Http.Settlement.makePayment")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* SettlementHttpErrors.apiEffect(
              settlement.makePayment({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "allocatePayment",
          Effect.fn("Http.Settlement.allocatePayment")(function* ({ headers, params, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* SettlementHttpErrors.apiEffect(
              settlement.allocatePayment({
                principal,
                tenantId: headers["x-tenant-id"],
                paymentId: params.id,
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "listPayments",
          Effect.fn("Http.Settlement.listPayments")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* SettlementHttpErrors.apiEffect(
              settlement.listPayments({ principal, tenantId: headers["x-tenant-id"], ...query }),
            )
          }),
        )
        .handle(
          "agingReport",
          Effect.fn("Http.Settlement.agingReport")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* SettlementHttpErrors.apiEffect(
              settlement.aging({ principal, tenantId: headers["x-tenant-id"], ...query }),
            )
          }),
        )
        .handle(
          "customerStatement",
          Effect.fn("Http.Settlement.customerStatement")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* SettlementHttpErrors.apiEffect(
              settlement.customerStatement({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "importBankStatement",
          Effect.fn("Http.Settlement.importBankStatement")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* SettlementHttpErrors.apiEffect(
              settlement.importBankStatement({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "matchBankLine",
          Effect.fn("Http.Settlement.matchBankLine")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* SettlementHttpErrors.apiEffect(
              settlement.matchBankLine({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "reverseBankMatch",
          Effect.fn("Http.Settlement.reverseBankMatch")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal

            return yield* SettlementHttpErrors.apiEffect(
              settlement.reverseBankMatch({
                principal,
                tenantId: headers["x-tenant-id"],
                matchId: params.id,
              }),
            )
          }),
        )
        .handle(
          "bankReconciliation",
          Effect.fn("Http.Settlement.bankReconciliation")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* SettlementHttpErrors.apiEffect(
              settlement.bankReconciliation({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
    }),
)
