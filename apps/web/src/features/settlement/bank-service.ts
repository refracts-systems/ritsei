import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  decodeInput,
  decodeResponse,
  mutationRequest,
  querySuffix,
  RequestFailure,
  requestJson,
  responseMatches,
} from "../../shared/api.ts"
import { Amount, CalendarDate, Uuid } from "../../shared/schemas.ts"

const BankReconciliation = Schema.Struct({
  legalEntityId: Uuid,
  bankAccountId: Uuid,
  lines: Schema.Array(
    Schema.Struct({
      id: Uuid,
      statementId: Uuid,
      sourceName: Schema.String,
      lineNumber: Schema.Int,
      reference: Schema.NullOr(Schema.String),
      bookingDate: CalendarDate,
      description: Schema.String,
      amount: Schema.String,
      unmatchedAmount: Amount,
    }),
  ).check(Schema.isMaxLength(200)),
  payments: Schema.Array(
    Schema.Struct({
      id: Uuid,
      number: Schema.String,
      direction: Schema.Literals(["incoming", "outgoing"]),
      paymentDate: CalendarDate,
      unmatchedCash: Amount,
    }),
  ).check(Schema.isMaxLength(200)),
  matches: Schema.Array(
    Schema.Struct({
      id: Uuid,
      lineId: Uuid,
      statementId: Uuid,
      paymentId: Uuid,
      paymentNumber: Schema.String,
      bookingDate: CalendarDate,
      description: Schema.String,
      amount: Amount,
      sourceName: Schema.String,
      lineNumber: Schema.Int,
      reference: Schema.NullOr(Schema.String),
    }),
  ).check(Schema.isMaxLength(200)),
})

export type BankReconciliation = Schema.Schema.Type<typeof BankReconciliation>

const ViewInput = Schema.Struct({
  legalEntityId: Uuid,
  bankAccountId: Uuid,
  afterMatchId: Schema.optionalKey(Uuid),
  lineOffset: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  ),
  paymentOffset: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  ),
})

const StatementInput = Schema.Struct({
  legalEntityId: Uuid,
  bankAccountId: Uuid,
  sourceName: Schema.String,
  content: Schema.String,
})

const MatchInput = Schema.Struct({ lineId: Uuid, paymentId: Uuid, amount: Amount })

const Match = Schema.Struct({
  id: Uuid,
  lineId: Uuid,
  paymentId: Uuid,
  amount: Amount,
  reversed: Schema.Boolean,
})

const Statement = Schema.Struct({
  id: Uuid,
  legalEntityId: Uuid,
  bankAccountId: Uuid,
  lineCount: Schema.Int,
})

export type BankMatch = Schema.Schema.Type<typeof Match>

export type ImportedStatement = Schema.Schema.Type<typeof Statement>

export const getBankReconciliation = Effect.fn("Frontend.Settlement.bankReconciliation")(function* (
  input: Schema.Codec.Encoded<typeof ViewInput>,
) {
  const decoded = yield* decodeInput(ViewInput, input)

  const body = yield* requestJson(
    `/settlement/bank-reconciliation${querySuffix({ ...decoded, limit: 50 })}`,
  )

  const result = yield* decodeResponse(BankReconciliation, body)

  if (
    !responseMatches(result, {
      legalEntityId: decoded.legalEntityId,
      bankAccountId: decoded.bankAccountId,
    })
  ) {
    return yield* Effect.fail(new RequestFailure({ kind: "invalid-response" }))
  }

  return result
})

export const importStatement = Effect.fn("Frontend.Settlement.importStatement")(function* (
  input: Schema.Codec.Encoded<typeof StatementInput>,
) {
  const decoded = yield* decodeInput(StatementInput, input)
  const body = yield* mutationRequest("/settlement/bank-statements", decoded)

  const result = yield* decodeResponse(Statement, body, "unknown-outcome")

  if (
    !responseMatches(result, {
      legalEntityId: decoded.legalEntityId,
      bankAccountId: decoded.bankAccountId,
    })
  ) {
    return yield* Effect.fail(new RequestFailure({ kind: "unknown-outcome" }))
  }

  return result
})

export const matchLine = Effect.fn("Frontend.Settlement.matchLine")(function* (
  input: Schema.Codec.Encoded<typeof MatchInput>,
) {
  const decoded = yield* decodeInput(MatchInput, input)
  const body = yield* mutationRequest("/settlement/bank-matches", decoded)

  const result = yield* decodeResponse(Match, body, "unknown-outcome")

  if (
    !responseMatches(result, {
      lineId: decoded.lineId,
      paymentId: decoded.paymentId,
      reversed: false,
    })
  ) {
    return yield* Effect.fail(new RequestFailure({ kind: "unknown-outcome" }))
  }

  return result
})

export const reverseMatch = Effect.fn("Frontend.Settlement.reverseMatch")(function* (id: string) {
  const decoded = yield* decodeInput(Uuid, id)
  const body = yield* mutationRequest(`/settlement/bank-matches/${decoded}/reversal`)

  const result = yield* decodeResponse(Match, body, "unknown-outcome")

  if (!responseMatches(result, { id: decoded, reversed: true })) {
    return yield* Effect.fail(new RequestFailure({ kind: "unknown-outcome" }))
  }

  return result
})

export const bankFailureMessages = {
  InvalidBankStatement: "The statement is invalid. Check its CSV format and contents.",
  BankLineNotFound: "The statement line is no longer available. Reload reconciliation.",
  PaymentNotFound: "The payment is no longer available. Reload reconciliation.",
  BankMatchNotFound: "The match is no longer available. Reload reconciliation.",
  BankMatchMismatch: "Choose a payment for the same account and direction as the statement line.",
  BankMatchExceedsAvailable:
    "The amount exceeds the remaining unmatched amount. Reload reconciliation.",
  AccountNotFound: "The account is no longer available. Choose another account.",
} as const
