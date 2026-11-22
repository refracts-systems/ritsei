import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  AuthorizationDenied,
  type CapabilityType,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import { makeMessagingTestLayer } from "../../../../framework/modules/messaging/mod.ts"
import {
  AbsentOrder,
  AbsentQuotation,
  AcceptQuotation,
  CancelledOrder,
  CancelOrder,
  ConfirmedOrder,
  ConfirmOrder,
  CreateOrder,
  CreatePartyCustomer,
  CustomerOfRelationship,
  CustomerPartyRoleInvalid,
  DraftOrder,
  DraftQuotation,
  ExpireQuotation,
  OrderCancelled,
  OrderConfirmed,
  NoCustomer,
  OpenQuotation,
  OrderCreated,
  PartyCustomer,
  PartyCustomerCreated,
  ProductPriceNotFound,
  Quotation,
  QuotationAccepted,
  QuotationCustomerMismatch,
  QuotationDrafted,
  QuotationExpired,
  QuotationInvalidState,
  QuotationNotFound,
  QuotationRejected,
  QuotationSent,
  RejectQuotation,
  Sales,
  SalesOrder,
  SalesOrderConfirmationIdempotencyConflict,
  SalesOrderInvalidState,
  SalesOrderNotFound,
  SendQuotation,
} from "../src/domain-model.ts"
import { makeSalesTestLayer, SalesService, type SalesServiceContract } from "../mod.ts"

const { Story } = Domain

const story = Story.make(Sales)

const itemA = "00000000-0000-4000-8000-000000000041"
const itemB = "00000000-0000-4000-8000-000000000042"

// ---------------------------------------------------------------- SAL-ORDER-1, SAL-ORDER-3

const order = SalesOrder.ref("o-1")

const lines = [
  { itemId: itemA, quantity: "2", unitPrice: "10.50" },
  { itemId: itemB, quantity: "3", unitPrice: "1.25" },
]

const orderBody = { customerId: "c-1", quotationId: null, lines, total: "24.75" }
const draftOrder = DraftOrder.make(orderBody)

const confirmedOrder = (key: string) =>
  ConfirmedOrder.make({ ...orderBody, confirmationIdempotencyKey: key })

const cancelledOrder = (key: string) =>
  CancelledOrder.make({ ...orderBody, confirmationIdempotencyKey: key })

const created = new OrderCreated({ customerId: "c-1", quotationId: null, lines, total: "24.75" })
const confirmed = new OrderConfirmed({ idempotencyKey: "k-1" })

describe("SAL-ORDER-1 on Alchemy: orders move only draft, confirmed, cancelled", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(Sales), []))

  // [SAL-ORDER-1]
  it.effect("confirms a draft once and keeps the snapshot", () =>
    story(
      Story.given(order, created),
      Story.when(order, new ConfirmOrder({ idempotencyKey: "k-1" })),
      Story.then(order, confirmed),
      Story.state(order, (state) => assert.deepStrictEqual(state, confirmedOrder("k-1"))),
      // The same key again records nothing; another key is refused.
      Story.when(order, new ConfirmOrder({ idempotencyKey: "k-1" })),
      Story.then(order),
      Story.when(order, new ConfirmOrder({ idempotencyKey: "k-2" })),
      Story.rejected(new SalesOrderConfirmationIdempotencyConflict()),
      Story.then(order),
    ),
  )

  // [SAL-ORDER-1]
  it.effect("cancels only a confirmed order and keeps its confirmation metadata", () =>
    story(
      Story.given(order, created, confirmed),
      Story.when(order, new CancelOrder({})),
      Story.then(order, new OrderCancelled()),
      Story.state(order, (state) => assert.deepStrictEqual(state, cancelledOrder("k-1"))),
      // Cancelling a cancelled order is a no-op.
      Story.when(order, new CancelOrder({})),
      Story.then(order),
    ),
  )

  // [SAL-ORDER-1]
  it.effect("never reopens a cancelled order, with the old key or a new one", () =>
    story(
      Story.given(order, created, confirmed, new OrderCancelled()),
      Story.when(order, new ConfirmOrder({ idempotencyKey: "k-1" })),
      Story.rejected(new SalesOrderInvalidState({ status: "cancelled" })),
      Story.when(order, new ConfirmOrder({ idempotencyKey: "k-2" })),
      Story.rejected(new SalesOrderInvalidState({ status: "cancelled" })),
      Story.then(order),
      Story.state(order, (state) => assert.deepStrictEqual(state, cancelledOrder("k-1"))),
    ),
  )

  // [SAL-ORDER-1]
  it.effect("refuses to cancel a draft", () =>
    story(
      Story.given(order, created),
      Story.when(order, new CancelOrder({})),
      Story.rejected(new SalesOrderInvalidState({ status: "draft" })),
      Story.then(order),
      Story.state(order, (state) => assert.deepStrictEqual(state, draftOrder)),
    ),
  )

  // [SAL-ORDER-1]
  it.effect("refuses to confirm or cancel an order that does not exist", () =>
    story(
      Story.when(order, new ConfirmOrder({ idempotencyKey: "k-1" })),
      Story.rejected(new SalesOrderNotFound()),
      Story.when(order, new CancelOrder({})),
      Story.rejected(new SalesOrderNotFound()),
      Story.then(order),
    ),
  )
})

describe("SAL-ORDER-3 on Alchemy: order references stay with one customer", () => {
  // [SAL-ORDER-3]
  it.effect("creates a draft from a quotation of the same customer, deriving the total", () =>
    story(
      Story.when(
        order,
        new CreateOrder({
          customerId: "c-1",
          quotation: { id: "q-1", customerId: "c-1" },
          lines,
        }),
      ),
      Story.then(
        order,
        new OrderCreated({ customerId: "c-1", quotationId: "q-1", lines, total: "24.75" }),
      ),
      Story.state(order, (state) =>
        assert.deepStrictEqual(state, DraftOrder.make({ ...orderBody, quotationId: "q-1" })),
      ),
    ),
  )

  // [SAL-ORDER-3]
  it.effect("refuses a quotation of another customer and creates nothing", () =>
    story(
      Story.when(
        order,
        new CreateOrder({
          customerId: "c-1",
          quotation: { id: "q-1", customerId: "c-2" },
          lines,
        }),
      ),
      Story.rejected(new QuotationCustomerMismatch({ quotationId: "q-1", customerId: "c-1" })),
      Story.then(order),
      Story.state(order, (state) => assert.deepStrictEqual(state, AbsentOrder.make({}))),
    ),
  )

  // [SAL-ORDER-3]
  it.effect("creates a draft without a quotation", () =>
    story(
      Story.when(order, new CreateOrder({ customerId: "c-1", lines })),
      Story.then(
        order,
        new OrderCreated({ customerId: "c-1", quotationId: null, lines, total: "24.75" }),
      ),
    ),
  )

  // [SAL-ORDER-3]
  it.effect("bounds line quantities to positive integers within PostgreSQL bigint", () =>
    Effect.gen(function* () {
      // The command cannot be built from a line the contract would refuse.
      const build = (quantity: string) =>
        Effect.try(
          () =>
            new CreateOrder({
              customerId: "c-1",
              lines: [{ itemId: itemA, quantity, unitPrice: "1.00" }],
            }),
        )

      for (const quantity of ["0", "-1", "1.5", "01", "9223372036854775808"]) {
        yield* Effect.flip(build(quantity))
      }

      yield* build("1")
      yield* build("9223372036854775807")
    }),
  )
})

// ---------------------------------------------------------------- SAL-QUOT-1, SAL-QUOT-2

const quotation = Quotation.ref("q-1")

// `drafted(validUntil)` and `quotationAt` describe the same quotation: no lines, total 0.00.
const quotationAt = (
  status: "draft" | "sent" | "accepted" | "rejected" | "expired",
  validUntil: string,
) => OpenQuotation.make({ status, customerId: "c-1", validUntil, lines: [], total: "0.00" })

const drafted = (validUntil: string) =>
  new QuotationDrafted({
    customerId: "c-1",
    legalEntityId: "le-1",
    validUntil,
    lines: [],
    total: "0.00",
  })

const pricedLine = (
  productId: string,
  quantity: string,
  listPrice: string,
  discountPercent: string,
  unitPrice: string,
  lineTotal: string,
) => ({
  productId,
  quantity,
  listPrice,
  discountPercent,
  unitPrice,
  taxCodeId: null,
  lineTotal,
})

const taxedLine = (productId: string, taxCodeId: string | null) => ({
  ...pricedLine(productId, "1", "1.00", "0.00", "1.00", "1.00"),
  taxCodeId,
})

describe("SAL-QUOT-1 on Alchemy: a quotation is priced from the list price or the price list", () => {
  // [SAL-QUOT-1]
  it.effect("prefers the line's list price, then the customer's price list", () =>
    story(
      Story.when(
        quotation,
        new DraftQuotation({
          customerId: "c-1",
          legalEntityId: "le-1",
          validUntil: "2026-12-31",
          lines: [
            { productId: "p-1", quantity: "2", listPrice: "20.00", priceListPrice: "99.00" },
            { productId: "p-2", quantity: "3", priceListPrice: "5.50" },
          ],
        }),
      ),
      Story.then(
        quotation,
        new QuotationDrafted({
          customerId: "c-1",
          legalEntityId: "le-1",
          validUntil: "2026-12-31",
          lines: [
            {
              productId: "p-1",
              quantity: "2",
              listPrice: "20.00",
              discountPercent: "0.00",
              unitPrice: "20.00",
              taxCodeId: null,
              lineTotal: "40.00",
            },
            {
              productId: "p-2",
              quantity: "3",
              listPrice: "5.50",
              discountPercent: "0.00",
              unitPrice: "5.50",
              taxCodeId: null,
              lineTotal: "16.50",
            },
          ],
          total: "56.50",
        }),
      ),
    ),
  )

  // [SAL-QUOT-1]
  it.effect("refuses a line with neither a list price nor a price list price", () =>
    story(
      Story.when(
        quotation,
        new DraftQuotation({
          customerId: "c-1",
          legalEntityId: "le-1",
          validUntil: "2026-12-31",
          lines: [{ productId: "p-9", quantity: "1" }],
        }),
      ),
      Story.rejected(new ProductPriceNotFound({ productId: "p-9" })),
      Story.then(quotation),
      Story.state(quotation, (state) => assert.deepStrictEqual(state, AbsentQuotation.make({}))),
    ),
  )

  // [SAL-QUOT-1]
  it.effect("applies the discount rounded half up to the cent and derives the total", () =>
    story(
      Story.when(
        quotation,
        new DraftQuotation({
          customerId: "c-1",
          legalEntityId: "le-1",
          validUntil: "2026-12-31",
          lines: [
            { productId: "p-1", quantity: "3", listPrice: "100.00", discountPercent: "12.5" },
            { productId: "p-2", quantity: "1", listPrice: "19.99", discountPercent: "10" },
            { productId: "p-3", quantity: "1", listPrice: "0.01", discountPercent: "50" },
          ],
        }),
      ),
      Story.then(
        quotation,
        new QuotationDrafted({
          customerId: "c-1",
          legalEntityId: "le-1",
          validUntil: "2026-12-31",
          lines: [
            pricedLine("p-1", "3", "100.00", "12.50", "87.50", "262.50"),
            pricedLine("p-2", "1", "19.99", "10.00", "17.99", "17.99"),
            pricedLine("p-3", "1", "0.01", "50.00", "0.01", "0.01"),
          ],
          total: "280.50",
        }),
      ),
    ),
  )

  // [SAL-QUOT-1]
  it.effect("defaults the tax code from Tax unless the line states one, even null", () =>
    story(
      Story.when(
        quotation,
        new DraftQuotation({
          customerId: "c-1",
          legalEntityId: "le-1",
          validUntil: "2026-12-31",
          lines: [
            { productId: "p-1", quantity: "1", listPrice: "1.00", defaultTaxCodeId: "vat" },
            { productId: "p-2", quantity: "1", listPrice: "1.00" },
            {
              productId: "p-3",
              quantity: "1",
              listPrice: "1.00",
              taxCodeId: "exempt",
              defaultTaxCodeId: "vat",
            },
            {
              productId: "p-4",
              quantity: "1",
              listPrice: "1.00",
              taxCodeId: null,
              defaultTaxCodeId: "vat",
            },
          ],
        }),
      ),
      Story.then(
        quotation,
        new QuotationDrafted({
          customerId: "c-1",
          legalEntityId: "le-1",
          validUntil: "2026-12-31",
          lines: [
            taxedLine("p-1", "vat"),
            taxedLine("p-2", null),
            taxedLine("p-3", "exempt"),
            taxedLine("p-4", null),
          ],
          total: "4.00",
        }),
      ),
    ),
  )
})

describe("SAL-QUOT-2 on Alchemy: quotations move draft, sent, then accepted or rejected, or expire", () => {
  // [SAL-QUOT-2]
  it.effect("moves draft to sent to accepted, and a repeat returns it unchanged", () =>
    story(
      Story.given(quotation, drafted("2026-12-31")),
      Story.when(quotation, new SendQuotation({})),
      Story.then(quotation, new QuotationSent()),
      Story.when(quotation, new SendQuotation({})),
      Story.then(quotation),
      Story.when(quotation, new AcceptQuotation({})),
      Story.then(quotation, new QuotationAccepted()),
      Story.when(quotation, new AcceptQuotation({})),
      Story.then(quotation),
      Story.state(quotation, (state) =>
        assert.deepStrictEqual(state, quotationAt("accepted", "2026-12-31")),
      ),
    ),
  )

  // [SAL-QUOT-2]
  it.effect("moves sent to rejected and refuses to accept it afterwards", () =>
    story(
      Story.given(quotation, drafted("2026-12-31"), new QuotationSent()),
      Story.when(quotation, new RejectQuotation({})),
      Story.then(quotation, new QuotationRejected()),
      Story.when(quotation, new RejectQuotation({})),
      Story.then(quotation),
      Story.when(quotation, new AcceptQuotation({})),
      Story.rejected(new QuotationInvalidState({ status: "rejected" })),
      Story.then(quotation),
    ),
  )

  // [SAL-QUOT-2]
  it.effect("refuses to decide a draft and to send a decided quotation", () =>
    story(
      Story.given(quotation, drafted("2026-12-31")),
      Story.when(quotation, new AcceptQuotation({})),
      Story.rejected(new QuotationInvalidState({ status: "draft" })),
      Story.when(quotation, new RejectQuotation({})),
      Story.rejected(new QuotationInvalidState({ status: "draft" })),
      Story.given(quotation, new QuotationSent(), new QuotationAccepted()),
      Story.when(quotation, new SendQuotation({})),
      Story.rejected(new QuotationInvalidState({ status: "accepted" })),
      Story.then(quotation),
    ),
  )

  // [SAL-QUOT-2]
  it.effect("refuses a quotation that does not exist", () =>
    story(
      Story.when(quotation, new SendQuotation({})),
      Story.rejected(new QuotationNotFound()),
      Story.then(quotation),
    ),
  )

  // [SAL-QUOT-2]
  it.effect("expires a sent quotation only after its validity, and never decides it again", () =>
    story(
      Story.given(quotation, drafted("2026-06-30"), new QuotationSent()),
      // `expireQuotations` compares strictly: the last valid day is not expired.
      Story.when(quotation, new ExpireQuotation({ asOf: "2026-06-30" })),
      Story.then(quotation),
      Story.when(quotation, new ExpireQuotation({ asOf: "2026-07-01" })),
      Story.then(quotation, new QuotationExpired()),
      Story.when(quotation, new ExpireQuotation({ asOf: "2026-07-01" })),
      Story.then(quotation),
      Story.when(quotation, new AcceptQuotation({})),
      Story.rejected(new QuotationInvalidState({ status: "expired" })),
      Story.then(quotation),
    ),
  )

  // [SAL-QUOT-2]
  it.effect("leaves drafts and decided quotations alone when expiring", () =>
    story(
      Story.given(quotation, drafted("2026-06-30")),
      Story.when(quotation, new ExpireQuotation({ asOf: "2027-01-01" })),
      Story.then(quotation),
      Story.given(quotation, new QuotationSent(), new QuotationRejected()),
      Story.when(quotation, new ExpireQuotation({ asOf: "2027-01-01" })),
      Story.then(quotation),
      Story.state(quotation, (state) =>
        assert.deepStrictEqual(state, quotationAt("rejected", "2026-06-30")),
      ),
    ),
  )
})

// ---------------------------------------------------------------- SAL-CUST-2

const relationship = PartyCustomer.ref("rel-1")

const customerOf = (kind: string, active: boolean) =>
  new CreatePartyCustomer({
    relationship: { kind, active },
    partyId: "party-1",
    legalEntityId: "le-1",
    name: "PT Buyer",
    email: " Buyer@Example.test ",
  })

describe("SAL-CUST-2 on Alchemy: a document customer is a Party customer role", () => {
  // [SAL-CUST-2]
  it.effect("creates a customer from an active customer relationship, once", () =>
    story(
      Story.when(relationship, customerOf("customer", true)),
      Story.then(
        relationship,
        new PartyCustomerCreated({
          partyId: "party-1",
          legalEntityId: "le-1",
          name: "PT Buyer",
          email: "buyer@example.test",
        }),
      ),
      // The same relationship returns the existing customer: nothing new, nothing replaced.
      Story.when(
        relationship,
        new CreatePartyCustomer({
          relationship: { kind: "customer", active: true },
          partyId: "party-1",
          legalEntityId: "le-1",
          name: "Renamed",
          email: "other@example.test",
        }),
      ),
      Story.then(relationship),
      Story.state(relationship, (state) =>
        assert.deepStrictEqual(
          state,
          CustomerOfRelationship.make({
            partyId: "party-1",
            legalEntityId: "le-1",
            name: "PT Buyer",
            email: "buyer@example.test",
          }),
        ),
      ),
    ),
  )

  // [SAL-CUST-2]
  it.effect("refuses a supplier relationship and an inactive customer relationship", () =>
    story(
      Story.when(relationship, customerOf("supplier", true)),
      Story.rejected(new CustomerPartyRoleInvalid()),
      Story.when(relationship, customerOf("customer", false)),
      Story.rejected(new CustomerPartyRoleInvalid()),
      Story.then(relationship),
      Story.state(relationship, (state) => assert.deepStrictEqual(state, NoCustomer.make({}))),
    ),
  )

  // [SAL-CUST-2]
  it.effect("checks the role before returning an existing customer", () =>
    story(
      Story.given(
        relationship,
        new PartyCustomerCreated({
          partyId: "party-1",
          legalEntityId: "le-1",
          name: "PT Buyer",
          email: "buyer@example.test",
        }),
      ),
      Story.when(relationship, customerOf("customer", false)),
      Story.rejected(new CustomerPartyRoleInvalid()),
      Story.then(relationship),
    ),
  )
})

// ---------------------------------------------------------------- SAL-AUTH-1

const principal = { userAccountId: "seller", sessionId: "session" }
const tenantId = "00000000-0000-4000-8000-000000000001"
const otherTenantId = "00000000-0000-4000-8000-000000000002"
const missingId = "00000000-0000-4000-8000-000000000099"

const metadata = {
  commandId: "auth-command",
  correlationId: "auth-correlation",
  causationId: null,
} as const

// Every capability a `SalesService` operation needs, by the operations that need it.
const operations: ReadonlyArray<
  readonly [
    capability: CapabilityType,
    operation: string,
    call: (
      sales: SalesServiceContract,
      scope: { readonly principal: typeof principal; readonly tenantId: string },
    ) => Effect.Effect<unknown, unknown>,
  ]
> = [
  ["sales.customer.read", "listCustomers", (sales, scope) => sales.listCustomers(scope)],
  [
    "sales.customer.read",
    "getCustomer",
    (sales, scope) => sales.getCustomer({ ...scope, customerId: missingId }),
  ],
  [
    "sales.customer.create",
    "createCustomer",
    (sales, scope) => sales.createCustomer({ ...scope, name: "ACME", email: "acme@example.test" }),
  ],
  ["sales.quotation.read", "listQuotations", (sales, scope) => sales.listQuotations(scope)],
  [
    "sales.quotation.read",
    "getQuotation",
    (sales, scope) => sales.getQuotation({ ...scope, quotationId: missingId }),
  ],
  [
    "sales.quotation.create",
    "createQuotation",
    (sales, scope) => sales.createQuotation({ ...scope, customerId: missingId, total: "1.00" }),
  ],
  ["sales.order.read", "listOrders", (sales, scope) => sales.listOrders(scope)],
  [
    "sales.order.read",
    "getOrder",
    (sales, scope) => sales.getOrder({ ...scope, orderId: missingId }),
  ],
  [
    "sales.order.read",
    "getConfirmedOrderTotal",
    (sales, scope) => sales.getConfirmedOrderTotal({ ...scope, orderId: missingId }),
  ],
  [
    "sales.order.create",
    "createOrder",
    (sales, scope) =>
      sales.createOrder({
        ...scope,
        customerId: missingId,
        lines: [{ itemId: itemA, quantity: "1", unitPrice: "1.00" }],
      }),
  ],
  [
    "sales.order.confirm",
    "confirmOrder",
    (sales, scope) =>
      sales.confirmOrder({ ...scope, orderId: missingId, ...metadata, idempotencyKey: "auth" }),
  ],
  [
    "sales.order.cancel",
    "cancelConfirmedOrder",
    (sales, scope) => sales.cancelConfirmedOrder({ ...scope, orderId: missingId }),
  ],
]

const allCapabilities = [...new Set(operations.map(([capability]) => capability))]

const grants = (capabilities: ReadonlyArray<CapabilityType>, tenants: ReadonlyArray<string>) =>
  tenants.flatMap((tenant) =>
    capabilities.map((capability) => ({
      userAccountId: principal.userAccountId,
      tenantId: tenant,
      capability,
    })),
  )

const withGrants = <A, E>(
  granted: ReturnType<typeof grants>,
  program: Effect.Effect<A, E, SalesService>,
) =>
  Effect.provide(
    program,
    makeSalesTestLayer().pipe(
      Layer.provide(Layer.merge(makeAuthorizationTestLayer(granted), makeMessagingTestLayer())),
    ),
  )

describe("SAL-AUTH-1 on the production service: capabilities are denied by default", () => {
  for (const [capability, operation, call] of operations) {
    // [SAL-AUTH-1]
    it.effect(`[SAL-AUTH-1] ${operation} is refused without ${capability} in the tenant`, () =>
      withGrants(
        grants(
          allCapabilities.filter((other) => other !== capability),
          [tenantId],
        ),
        Effect.gen(function* () {
          const sales = yield* SalesService

          assert.instanceOf(
            yield* Effect.flip(call(sales, { principal, tenantId })),
            AuthorizationDenied,
          )
        }),
      ),
    )

    // [SAL-AUTH-1]
    it.effect(
      `[SAL-AUTH-1] ${operation} is refused when ${capability} is granted in another tenant`,
      () =>
        withGrants(
          grants(allCapabilities, [otherTenantId]),
          Effect.gen(function* () {
            const sales = yield* SalesService

            assert.instanceOf(
              yield* Effect.flip(call(sales, { principal, tenantId })),
              AuthorizationDenied,
            )
          }),
        ),
    )

    // [SAL-AUTH-1]
    it.effect(`[SAL-AUTH-1] ${operation} passes authorization once ${capability} is granted`, () =>
      withGrants(
        grants([capability], [tenantId]),
        Effect.gen(function* () {
          const sales = yield* SalesService
          const result = yield* Effect.result(call(sales, { principal, tenantId }))

          // The call may still fail on its own terms (the ids are absent); only a denial is wrong.
          assert.isFalse(Result.isFailure(result) && result.failure instanceof AuthorizationDenied)
        }),
      ),
    )
  }
})
