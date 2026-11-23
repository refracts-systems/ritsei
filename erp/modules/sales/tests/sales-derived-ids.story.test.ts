import { assert, describe, it } from "@effect/vitest"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  ConvertedQuotation,
  ConvertQuotation,
  CreateCustomer,
  CreatePriceList,
  CustomerAlreadyExists,
  CustomerCreated,
  customerRef,
  LegacyCustomer,
  NamedPriceList,
  OrderConvertedFromQuotation,
  PriceListAlreadyExists,
  PriceListCreated,
  priceListRef,
  QuotationInvalidState,
  quotationOrderRef,
  Sales,
} from "../src/domain-model.ts"
import { canonicalEmail, customerKey, priceListKey, quotationOrderKey } from "../src/derived-ids.ts"

const { Story } = Domain

const story = Story.make(Sales)

const tenantA = "00000000-0000-4000-8000-0000000000a1"
const tenantB = "00000000-0000-4000-8000-0000000000b2"

describe("phase 3 derived ids on Alchemy: sales", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(Sales), []))

  // [SAL-CUST-1]
  it.effect("a customer email is created once per tenant, however it is written", () => {
    const customer = customerRef(tenantA, "ada@example.com")

    return story(
      Story.when(customer, new CreateCustomer({ name: " Ada ", email: " Ada@Example.COM " })),
      Story.then(customer, new CustomerCreated({ name: "Ada", email: "ada@example.com" })),
      Story.state(customer, (state) =>
        assert.deepStrictEqual(
          state,
          LegacyCustomer.make({ name: "Ada", email: "ada@example.com" }),
        ),
      ),
      // Production refuses the duplicate (`CustomerAlreadyExists`), with any name.
      Story.when(customer, new CreateCustomer({ name: "Ada", email: "ada@example.com" })),
      Story.rejected(new CustomerAlreadyExists({ email: "ada@example.com" })),
      Story.when(customer, new CreateCustomer({ name: "Other", email: "ADA@example.com" })),
      Story.rejected(new CustomerAlreadyExists({ email: "ada@example.com" })),
      Story.then(customer),
    )
  })

  // [SAL-CUST-1]
  it.effect("another tenant's same email is a different customer", () =>
    story(
      Story.given(
        customerRef(tenantA, "ada@example.com"),
        new CustomerCreated({ name: "Ada", email: "ada@example.com" }),
      ),
      Story.when(
        customerRef(tenantB, "ada@example.com"),
        new CreateCustomer({ name: "Ada", email: "ada@example.com" }),
      ),
      Story.then(
        customerRef(tenantB, "ada@example.com"),
        new CustomerCreated({ name: "Ada", email: "ada@example.com" }),
      ),
    ),
  )

  // [SAL-CUST-1]
  it("the customer key is built from the tenant and the canonical email", () => {
    assert.strictEqual(customerKey(tenantA, " A@B.C "), customerKey(tenantA, "a@b.c"))
    assert.notStrictEqual(customerKey(tenantA, "a@b.c"), customerKey(tenantB, "a@b.c"))
    assert.strictEqual(canonicalEmail(" A@B.C "), "a@b.c")
  })

  // [SAL-PRICE-1]
  it.effect("a price list name is created once per tenant, with any currency", () => {
    const list = priceListRef(tenantA, "Retail")

    return story(
      Story.when(list, new CreatePriceList({ name: "Retail", currency: "IDR" })),
      Story.then(list, new PriceListCreated({ name: "Retail", currency: "IDR" })),
      Story.state(list, (state) =>
        assert.deepStrictEqual(state, NamedPriceList.make({ name: "Retail", currency: "IDR" })),
      ),
      Story.when(list, new CreatePriceList({ name: "Retail", currency: "IDR" })),
      Story.rejected(new PriceListAlreadyExists({ name: "Retail" })),
      Story.when(list, new CreatePriceList({ name: "Retail", currency: "USD" })),
      Story.rejected(new PriceListAlreadyExists({ name: "Retail" })),
      Story.then(list),
    )
  })

  // [SAL-PRICE-1]
  it.effect("another tenant's same name, and another name, are different price lists", () =>
    story(
      Story.given(
        priceListRef(tenantA, "Retail"),
        new PriceListCreated({ name: "Retail", currency: "IDR" }),
      ),
      Story.when(
        priceListRef(tenantB, "Retail"),
        new CreatePriceList({ name: "Retail", currency: "IDR" }),
      ),
      Story.then(
        priceListRef(tenantB, "Retail"),
        new PriceListCreated({ name: "Retail", currency: "IDR" }),
      ),
      // PostgreSQL compares names exactly, so another case is another list.
      Story.when(
        priceListRef(tenantA, "retail"),
        new CreatePriceList({ name: "retail", currency: "IDR" }),
      ),
      Story.then(
        priceListRef(tenantA, "retail"),
        new PriceListCreated({ name: "retail", currency: "IDR" }),
      ),
    ),
  )

  // [SAL-PRICE-1]
  it("the price list key is built from the tenant and the name", () => {
    assert.notStrictEqual(priceListKey(tenantA, "Retail"), priceListKey(tenantB, "Retail"))
    assert.notStrictEqual(priceListKey(tenantA, "Retail"), priceListKey(tenantA, "retail"))
  })

  // [SAL-QUOT-3]
  it.effect("an accepted quotation converts once and a repeat returns the same order", () => {
    const conversion = quotationOrderRef(tenantA, "q-1")

    return story(
      Story.when(conversion, new ConvertQuotation({ quotationStatus: "accepted", orderId: "o-1" })),
      Story.then(conversion, new OrderConvertedFromQuotation({ orderId: "o-1" })),
      // A repeat records nothing and keeps the first order, even with a new generated id.
      Story.when(conversion, new ConvertQuotation({ quotationStatus: "accepted", orderId: "o-2" })),
      Story.then(conversion),
      Story.state(conversion, (state) =>
        assert.deepStrictEqual(state, ConvertedQuotation.make({ orderId: "o-1" })),
      ),
    )
  })

  // [SAL-QUOT-3]
  it.effect("a quotation that is not accepted fails with its state", () => {
    const conversion = quotationOrderRef(tenantA, "q-1")

    return story(
      Story.when(conversion, new ConvertQuotation({ quotationStatus: "sent", orderId: "o-1" })),
      Story.rejected(new QuotationInvalidState({ status: "sent" })),
      Story.when(conversion, new ConvertQuotation({ quotationStatus: "expired", orderId: "o-1" })),
      Story.rejected(new QuotationInvalidState({ status: "expired" })),
      Story.then(conversion),
    )
  })

  // [SAL-QUOT-3]
  it.effect("an existing order is returned even after the quotation state moved on", () => {
    const conversion = quotationOrderRef(tenantA, "q-1")

    return story(
      Story.given(conversion, new OrderConvertedFromQuotation({ orderId: "o-1" })),
      Story.when(conversion, new ConvertQuotation({ quotationStatus: "expired", orderId: "o-2" })),
      Story.then(conversion),
    )
  })

  // [SAL-QUOT-3]
  it.effect("another tenant's or another quotation's conversion is a different instance", () =>
    story(
      Story.given(
        quotationOrderRef(tenantA, "q-1"),
        new OrderConvertedFromQuotation({ orderId: "o-1" }),
      ),
      Story.when(
        quotationOrderRef(tenantB, "q-1"),
        new ConvertQuotation({ quotationStatus: "accepted", orderId: "o-9" }),
      ),
      Story.then(
        quotationOrderRef(tenantB, "q-1"),
        new OrderConvertedFromQuotation({ orderId: "o-9" }),
      ),
      Story.when(
        quotationOrderRef(tenantA, "q-2"),
        new ConvertQuotation({ quotationStatus: "accepted", orderId: "o-8" }),
      ),
      Story.then(
        quotationOrderRef(tenantA, "q-2"),
        new OrderConvertedFromQuotation({ orderId: "o-8" }),
      ),
    ),
  )

  // [SAL-QUOT-3]
  it("the order key is built from the tenant and the quotation", () => {
    assert.notStrictEqual(quotationOrderKey(tenantA, "q-1"), quotationOrderKey(tenantB, "q-1"))
  })
})
