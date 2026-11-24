import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  AttemptFinished,
  attemptId,
  ChangeReceivable,
  ClaimHeld,
  ClaimKey,
  ConfirmAttempt,
  ConfirmationRefused,
  ConfirmationRequested,
  ConfirmWithCredit,
  CountInvoice,
  CreditedOrder,
  CreditLimitExceeded,
  CreditReleased,
  CreditReserved,
  CustomerExposure,
  CustomerId,
  InvoiceCounted,
  KeyClaim,
  KeyClaimed,
  KeyId,
  LimitSet,
  OrderConfirmed,
  OrderDrafted,
  OrderId,
  ReceivableChanged,
  ReleaseCredit,
  RequestConfirmation,
  ReserveCredit,
  SalesCredit,
  SalesCreditHandlers,
  SetCreditLimit,
} from "../src/credit-exposure-model.ts"

const { Story } = Domain

type Outcome = Data.TaggedEnum<{
  Completed: { readonly result: undefined }
  Rejected: { readonly rejection: CreditLimitExceeded | ClaimHeld }
}>

const Outcome = Data.taggedEnum<Outcome>()

const story = Story.make(SalesCredit, { layer: SalesCreditHandlers })

const order = (id: string) => CreditedOrder.ref(OrderId.make(id))
const exposure = CustomerExposure.ref(CustomerId.make("c-1"))
const claim = (key: string) => KeyClaim.ref(KeyId.make(key))
const attempt = (id: string, n: number) => ConfirmAttempt.ref(attemptId(id, n))

const drafted = (total: string, confirmationKey: string) =>
  new OrderDrafted({ customerId: "c-1", total, confirmationKey })

const requested = (total: string, confirmationKey: string, n = 1) =>
  new ConfirmationRequested({ customerId: "c-1", total, confirmationKey, attempt: n })

const reserved = (orderId: string, total: string) => new CreditReserved({ orderId, total })

const limit = (creditLimit: string | null) => new LimitSet({ creditLimit })

const owes = (reference: string, delta: string) => new ReceivableChanged({ reference, delta })

const exceeded = (creditLimit: string, receivableBalance: string, orderTotal: string) =>
  new CreditLimitExceeded({ creditLimit, receivableBalance, orderTotal })

const completed = Outcome.Completed({ result: undefined })

describe("customer credit staged on an exposure aggregate (SAL-CREDIT-1, SAL-CREDIT-2)", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(SalesCredit), []))

  // [SAL-CREDIT-1]
  it.effect("an order within the limit reserves credit, claims its key, and is confirmed", () =>
    story(
      Story.given(exposure, limit("1000.00")),
      Story.given(order("o-1"), drafted("400.00", "k-1")),
      Story.when(order("o-1"), new RequestConfirmation({})),
      Story.then(order("o-1"), requested("400.00", "k-1"), new OrderConfirmed()),
      Story.then(exposure, reserved("o-1", "400.00")),
      Story.then(claim("k-1"), new KeyClaimed({ holder: "o-1" })),
      Story.then(attempt("o-1", 1), new AttemptFinished()),
      Story.saga(ConfirmWithCredit, attempt("o-1", 1), completed),
    ),
  )

  // [SAL-CREDIT-1]
  it.effect("an order past the limit is refused and stays a draft with nothing reserved", () =>
    story(
      Story.given(exposure, limit("1000.00"), owes("i-1", "700.00")),
      Story.given(order("o-1"), drafted("300.01", "k-1")),
      Story.when(order("o-1"), new RequestConfirmation({})),
      Story.then(order("o-1"), requested("300.01", "k-1"), new ConfirmationRefused()),
      Story.then(exposure),
      Story.then(claim("k-1")),
      Story.saga(
        ConfirmWithCredit,
        attempt("o-1", 1),
        Outcome.Rejected({ rejection: exceeded("1000.00", "700.00", "300.01") }),
      ),
    ),
  )

  // [SAL-CREDIT-1]
  it.effect("the limit itself is allowed: receivables and orders may add up to it exactly", () =>
    story(
      Story.given(exposure, limit("1000.00"), owes("i-1", "700.00")),
      Story.given(order("o-1"), drafted("300.00", "k-1")),
      Story.when(order("o-1"), new RequestConfirmation({})),
      Story.then(order("o-1"), requested("300.00", "k-1"), new OrderConfirmed()),
      Story.then(exposure, reserved("o-1", "300.00")),
      Story.then(claim("k-1"), new KeyClaimed({ holder: "o-1" })),
      Story.then(attempt("o-1", 1), new AttemptFinished()),
    ),
  )

  // [SAL-CREDIT-2]
  it.effect("two orders that fit alone but not together: only one is confirmed", () =>
    story(
      Story.given(exposure, limit("1000.00")),
      Story.given(order("o-1"), drafted("600.00", "k-1")),
      Story.given(order("o-2"), drafted("600.00", "k-2")),
      Story.when(order("o-1"), new RequestConfirmation({})),
      Story.then(order("o-1"), requested("600.00", "k-1"), new OrderConfirmed()),
      Story.then(exposure, reserved("o-1", "600.00")),
      Story.then(claim("k-1"), new KeyClaimed({ holder: "o-1" })),
      Story.then(attempt("o-1", 1), new AttemptFinished()),
      Story.when(order("o-2"), new RequestConfirmation({})),
      Story.then(order("o-2"), requested("600.00", "k-2"), new ConfirmationRefused()),
      Story.then(exposure),
      Story.then(claim("k-2")),
    ),
  )

  // [SAL-CREDIT-1]
  it.effect("a retried confirmation of a reserved order is not checked again", () =>
    story(
      Story.given(exposure, limit("1000.00"), reserved("o-1", "900.00")),
      // The limit was lowered after the order was confirmed.
      Story.when(exposure, new SetCreditLimit({ creditLimit: "100.00" })),
      Story.then(exposure, limit("100.00")),
      Story.when(exposure, new ReserveCredit({ orderId: "o-1", total: "900.00" })),
      Story.then(exposure),
      // A different order is checked against the lowered limit and the 900.00 already reserved.
      Story.when(exposure, new ReserveCredit({ orderId: "o-2", total: "0.01" })),
      Story.rejected(exceeded("100.00", "0.00", "0.01")),
    ),
  )

  // [SAL-CREDIT-1]
  it.effect("without a limit nothing is refused, but the credit is still reserved", () =>
    story(
      Story.when(exposure, new ReserveCredit({ orderId: "o-1", total: "5000.00" })),
      Story.then(exposure, reserved("o-1", "5000.00")),
      // A limit set later counts that order.
      Story.when(exposure, new SetCreditLimit({ creditLimit: "5000.00" })),
      Story.then(exposure, limit("5000.00")),
      Story.when(exposure, new ReserveCredit({ orderId: "o-2", total: "0.01" })),
      Story.rejected(exceeded("5000.00", "0.00", "0.01")),
      // Removing the limit lifts the check again.
      Story.when(exposure, new SetCreditLimit({ creditLimit: null })),
      Story.then(exposure, limit(null)),
      Story.when(exposure, new ReserveCredit({ orderId: "o-2", total: "0.01" })),
      Story.then(exposure, reserved("o-2", "0.01")),
    ),
  )

  // [SAL-CREDIT-1]
  it.effect("an invoice moves credit from committed to receivable, never below zero", () =>
    story(
      Story.given(exposure, limit("1000.00"), reserved("o-1", "100.00")),
      // 60.00 net, 66.00 total invoiced: receivable 66.00, committed 100.00 - 60.00 = 40.00.
      Story.when(
        exposure,
        new CountInvoice({ reference: "i-1", orderId: "o-1", net: "60.00", total: "66.00" }),
      ),
      Story.then(
        exposure,
        new InvoiceCounted({ reference: "i-1", orderId: "o-1", net: "60.00", total: "66.00" }),
      ),
      // 66.00 + 40.00 + 894.00 = 1000.00 fits; one cent more does not.
      Story.when(exposure, new ReserveCredit({ orderId: "o-2", total: "894.01" })),
      Story.rejected(exceeded("1000.00", "66.00", "894.01")),
      Story.when(exposure, new ReserveCredit({ orderId: "o-2", total: "894.00" })),
      Story.then(exposure, reserved("o-2", "894.00")),
    ),
  )

  // [SAL-CREDIT-1]
  it.effect("invoiced net beyond the order total leaves committed at zero, not negative", () =>
    story(
      Story.given(
        exposure,
        limit("100.00"),
        reserved("o-1", "50.00"),
        new InvoiceCounted({ reference: "i-1", orderId: "o-1", net: "60.00", total: "60.00" }),
      ),
      // Receivable is 60.00 and committed is 0, not -10.00: 40.00 fits, 40.01 does not.
      Story.when(exposure, new ReserveCredit({ orderId: "o-2", total: "40.01" })),
      Story.rejected(exceeded("100.00", "60.00", "40.01")),
      Story.when(exposure, new ReserveCredit({ orderId: "o-2", total: "40.00" })),
      Story.then(exposure, reserved("o-2", "40.00")),
    ),
  )

  // [SAL-CREDIT-1]
  it.effect("a settlement lowers the receivable and frees credit for the next order", () =>
    story(
      Story.given(exposure, limit("1000.00"), owes("i-1", "900.00")),
      Story.when(exposure, new ReserveCredit({ orderId: "o-1", total: "200.00" })),
      Story.rejected(exceeded("1000.00", "900.00", "200.00")),
      Story.when(exposure, new ChangeReceivable({ reference: "s-1", delta: "-500.00" })),
      Story.then(exposure, owes("s-1", "-500.00")),
      Story.when(exposure, new ReserveCredit({ orderId: "o-1", total: "200.00" })),
      Story.then(exposure, reserved("o-1", "200.00")),
    ),
  )

  // [SAL-CREDIT-1]
  it.effect("a receivable that arrives late lets an order past the limit: the lag state", () =>
    story(
      Story.given(exposure, limit("1000.00")),
      // An invoice of 900.00 for no sales order exists in Billing; the exposure has not heard.
      Story.when(exposure, new ReserveCredit({ orderId: "o-1", total: "500.00" })),
      Story.then(exposure, reserved("o-1", "500.00")),
      // When it arrives, the exposure is over the limit; nothing unconfirms the order.
      Story.when(exposure, new ChangeReceivable({ reference: "i-9", delta: "900.00" })),
      Story.then(exposure, owes("i-9", "900.00")),
      Story.when(exposure, new ReserveCredit({ orderId: "o-2", total: "0.01" })),
      Story.rejected(exceeded("1000.00", "900.00", "0.01")),
    ),
  )

  // [SAL-CREDIT-1]
  it.effect("a refused key claim releases the reservation and leaves the order a draft", () =>
    story(
      Story.given(exposure, limit("1000.00")),
      Story.given(claim("k-1"), new KeyClaimed({ holder: "o-other" })),
      Story.given(order("o-1"), drafted("600.00", "k-1")),
      Story.when(order("o-1"), new RequestConfirmation({})),
      Story.then(order("o-1"), requested("600.00", "k-1"), new ConfirmationRefused()),
      // The credit was reserved and released: production leaves nothing, staged leaves both.
      Story.then(exposure, reserved("o-1", "600.00"), new CreditReleased({ orderId: "o-1" })),
      Story.then(claim("k-1")),
      Story.saga(
        ConfirmWithCredit,
        attempt("o-1", 1),
        Outcome.Rejected({ rejection: new ClaimHeld({ holder: "o-other" }) }),
      ),
      // The released credit is free again for another order.
      Story.given(order("o-2"), drafted("1000.00", "k-2")),
      Story.when(order("o-2"), new RequestConfirmation({})),
      Story.then(order("o-2"), requested("1000.00", "k-2"), new OrderConfirmed()),
      Story.then(exposure, reserved("o-2", "1000.00")),
      Story.then(claim("k-2"), new KeyClaimed({ holder: "o-2" })),
      Story.then(attempt("o-2", 1), new AttemptFinished()),
    ),
  )

  // [SAL-CREDIT-1]
  it.effect("a draft refused for credit can be confirmed again as its own attempt", () =>
    story(
      Story.given(exposure, limit("1000.00"), owes("i-1", "900.00")),
      Story.given(order("o-1"), drafted("200.00", "k-1")),
      Story.when(order("o-1"), new RequestConfirmation({})),
      Story.then(order("o-1"), requested("200.00", "k-1"), new ConfirmationRefused()),
      Story.then(exposure),
      Story.then(claim("k-1")),
      Story.saga(
        ConfirmWithCredit,
        attempt("o-1", 1),
        Outcome.Rejected({ rejection: exceeded("1000.00", "900.00", "200.00") }),
      ),
      Story.when(exposure, new ChangeReceivable({ reference: "s-1", delta: "-500.00" })),
      Story.then(exposure, owes("s-1", "-500.00")),
      Story.when(order("o-1"), new RequestConfirmation({})),
      Story.then(order("o-1"), requested("200.00", "k-1", 2), new OrderConfirmed()),
      Story.then(exposure, reserved("o-1", "200.00")),
      Story.then(claim("k-1"), new KeyClaimed({ holder: "o-1" })),
      Story.then(attempt("o-1", 2), new AttemptFinished()),
    ),
  )

  // [SAL-CREDIT-1]
  it.effect("repeats record nothing: invoice, receivable, release, claim, and confirmation", () =>
    story(
      Story.given(
        exposure,
        reserved("o-1", "100.00"),
        new InvoiceCounted({ reference: "i-1", orderId: "o-1", net: "60.00", total: "66.00" }),
        owes("s-1", "-10.00"),
      ),
      Story.when(
        exposure,
        new CountInvoice({ reference: "i-1", orderId: "o-1", net: "99.00", total: "99.00" }),
      ),
      Story.then(exposure),
      Story.when(exposure, new ChangeReceivable({ reference: "s-1", delta: "-99.00" })),
      Story.then(exposure),
      Story.when(exposure, new ReleaseCredit({ orderId: "o-unknown" })),
      Story.then(exposure),
      Story.given(claim("k-1"), new KeyClaimed({ holder: "o-1" })),
      Story.when(claim("k-1"), new ClaimKey({ holder: "o-1" })),
      Story.then(claim("k-1")),
      Story.given(
        order("o-1"),
        drafted("100.00", "k-1"),
        requested("100.00", "k-1"),
        new OrderConfirmed(),
      ),
      Story.when(order("o-1"), new RequestConfirmation({})),
      Story.then(order("o-1")),
    ),
  )
})
