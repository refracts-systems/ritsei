import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  BankMatch,
  BankMatchNotFound,
  HoldMatch,
  HoldOnLine,
  HoldOnPayment,
  LineExceedsAvailable,
  LineHeld,
  LineId,
  LineOpened,
  LineReleased,
  MatchFailed,
  MatchId,
  MatchLine,
  MatchPayment,
  MatchRecorded,
  MatchRequested,
  MatchReversed,
  PaymentExceedsAvailable,
  PaymentHeld,
  PaymentId,
  PaymentOpened,
  PaymentReleased,
  ReleaseLine,
  ReleaseMatch,
  RequestMatch,
  ReverseMatch,
  ReversalRequested,
  SettlementBankMatching,
  SettlementBankMatchingHandlers,
} from "../src/bank-match-model.ts"

const { Story } = Domain

type Outcome = Data.TaggedEnum<{
  Completed: { readonly result: undefined }
  Rejected: { readonly rejection: LineExceedsAvailable | PaymentExceedsAvailable }
}>

const Outcome = Data.taggedEnum<Outcome>()

const story = Story.make(SettlementBankMatching, { layer: SettlementBankMatchingHandlers })

const line = (id: string) => MatchLine.ref(LineId.make(id))
const payment = (id: string) => MatchPayment.ref(PaymentId.make(id))
const match = (id: string) => BankMatch.ref(MatchId.make(id))

const completed = Outcome.Completed({ result: undefined })

// A statement line of 100.00 and two payments whose cash is 97.80 each (100.00 less 2.20 withheld).
const opened = [
  Story.given(line("l-1"), new LineOpened({ amount: "10000" })),
  Story.given(payment("p-1"), new PaymentOpened({ cash: "9780" })),
  Story.given(payment("p-2"), new PaymentOpened({ cash: "9780" })),
] as const

const ask = (matchId: string, paymentId: string, amount: string) =>
  Story.when(match(matchId), new RequestMatch({ lineId: "l-1", paymentId, amount }))

const requested = (paymentId: string, amount: string) =>
  new MatchRequested({ lineId: "l-1", paymentId, amount })

const lineHeld = (matchId: string, amount: string) => new LineHeld({ matchId, amount })
const paymentHeld = (matchId: string, amount: string) => new PaymentHeld({ matchId, amount })

describe("bank matching staged as sagas over two capacities (SET-BANK-3)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(SettlementBankMatching), []))

  // [SET-BANK-3]
  it.effect("a match holds the line and the payment, then records", () =>
    story(
      ...opened,
      ask("m-1", "p-1", "6000"),
      Story.then(match("m-1"), requested("p-1", "6000"), new MatchRecorded()),
      Story.then(line("l-1"), lineHeld("m-1", "6000")),
      Story.then(payment("p-1"), paymentHeld("m-1", "6000")),
      Story.saga(HoldMatch, match("m-1"), completed),
    ),
  )

  // [SET-BANK-3]
  it.effect("a match is capped by the payment's cash, which is its amount less withholding", () =>
    story(
      ...opened,
      ask("m-1", "p-1", "9781"),
      // The line was held for a match that cannot finish, then released; the match failed.
      Story.then(match("m-1"), requested("p-1", "9781"), new MatchFailed()),
      Story.then(line("l-1"), lineHeld("m-1", "9781"), new LineReleased({ matchId: "m-1" })),
      Story.then(payment("p-1")),
      Story.saga(
        HoldMatch,
        match("m-1"),
        Outcome.Rejected({ rejection: new PaymentExceedsAvailable({ available: "9780" }) }),
      ),
      // Exactly the cash is accepted.
      ask("m-2", "p-1", "9780"),
      Story.then(match("m-2"), requested("p-1", "9780"), new MatchRecorded()),
      Story.then(line("l-1"), lineHeld("m-2", "9780")),
      Story.then(payment("p-1"), paymentHeld("m-2", "9780")),
    ),
  )

  // [SET-BANK-3]
  it.effect("matches of one line never add up to more than the line", () =>
    story(
      ...opened,
      ask("m-1", "p-1", "6000"),
      Story.then(match("m-1"), requested("p-1", "6000"), new MatchRecorded()),
      Story.then(line("l-1"), lineHeld("m-1", "6000")),
      Story.then(payment("p-1"), paymentHeld("m-1", "6000")),
      ask("m-2", "p-2", "4001"),
      // The line refuses first, so the second payment is never held.
      Story.then(match("m-2"), requested("p-2", "4001"), new MatchFailed()),
      Story.then(line("l-1")),
      Story.then(payment("p-2")),
      Story.saga(
        HoldMatch,
        match("m-2"),
        Outcome.Rejected({ rejection: new LineExceedsAvailable({ available: "4000" }) }),
      ),
      ask("m-3", "p-2", "4000"),
      Story.then(match("m-3"), requested("p-2", "4000"), new MatchRecorded()),
      Story.then(line("l-1"), lineHeld("m-3", "4000")),
      Story.then(payment("p-2"), paymentHeld("m-3", "4000")),
    ),
  )

  // [SET-BANK-3]
  it.effect("reversing a match releases both capacities, keeps the match, and is safe twice", () =>
    story(
      ...opened,
      ask("m-1", "p-1", "9780"),
      Story.then(match("m-1"), requested("p-1", "9780"), new MatchRecorded()),
      Story.then(line("l-1"), lineHeld("m-1", "9780")),
      Story.then(payment("p-1"), paymentHeld("m-1", "9780")),
      Story.when(match("m-1"), new ReverseMatch({})),
      Story.then(
        match("m-1"),
        new ReversalRequested({ lineId: "l-1", paymentId: "p-1", amount: "9780" }),
        new MatchReversed(),
      ),
      Story.then(line("l-1"), new LineReleased({ matchId: "m-1" })),
      Story.then(payment("p-1"), new PaymentReleased({ matchId: "m-1" })),
      Story.saga(ReleaseMatch, match("m-1"), completed),
      Story.when(match("m-1"), new ReverseMatch({})),
      Story.then(match("m-1")),
      // The freed capacity can be matched again.
      ask("m-2", "p-1", "9780"),
      Story.then(match("m-2"), requested("p-1", "9780"), new MatchRecorded()),
      Story.then(line("l-1"), lineHeld("m-2", "9780")),
      Story.then(payment("p-1"), paymentHeld("m-2", "9780")),
    ),
  )

  // [SET-BANK-3]
  it.effect("a match that never recorded cannot be reversed", () =>
    story(
      Story.when(match("m-9"), new ReverseMatch({})),
      Story.rejected(new BankMatchNotFound()),
      Story.then(match("m-9")),
      ...opened,
      ask("m-1", "p-1", "9781"),
      Story.then(match("m-1"), requested("p-1", "9781"), new MatchFailed()),
      Story.then(line("l-1"), lineHeld("m-1", "9781"), new LineReleased({ matchId: "m-1" })),
      Story.then(payment("p-1")),
      Story.when(match("m-1"), new ReverseMatch({})),
      Story.rejected(new BankMatchNotFound()),
    ),
  )

  // [SET-BANK-3]
  it.effect("a repeated match id records nothing, and a failed match's id is spent", () =>
    story(
      ...opened,
      Story.given(match("m-1"), requested("p-1", "6000"), new MatchRecorded()),
      Story.when(match("m-1"), new RequestMatch({ lineId: "l-1", paymentId: "p-2", amount: "1" })),
      Story.then(match("m-1")),
      Story.given(match("m-2"), requested("p-1", "9781"), new MatchFailed()),
      Story.when(match("m-2"), new RequestMatch({ lineId: "l-1", paymentId: "p-1", amount: "1" })),
      Story.then(match("m-2")),
    ),
  )

  // [SET-BANK-3]
  it.effect("a hold and a release apply once per match", () =>
    story(
      ...opened,
      Story.given(line("l-1"), lineHeld("m-1", "6000")),
      Story.when(line("l-1"), new HoldOnLine({ matchId: "m-1", amount: "6000" })),
      Story.then(line("l-1")),
      Story.when(line("l-1"), new ReleaseLine({ matchId: "m-9" })),
      Story.then(line("l-1")),
      Story.given(payment("p-1"), paymentHeld("m-1", "6000")),
      Story.when(payment("p-1"), new HoldOnPayment({ matchId: "m-1", amount: "6000" })),
      Story.then(payment("p-1")),
    ),
  )
})
