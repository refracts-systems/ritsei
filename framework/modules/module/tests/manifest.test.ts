import { assert, describe, it } from "@effect/vitest"

import { defineModule, validateModuleRegistry } from "../mod.ts"
import type { EventCatalogEntry, ModuleManifest } from "../mod.ts"
import { partial } from "../../../../tests/support/partial.ts"

const empty = {
  layer: "erp",
  dependsOn: [],
  schemas: [],
  capabilities: {},
  actions: [],
  events: [],
  consumes: [],
  http: [],
  pages: [],
} as const

const releasedEvent = (owningDomain: string, id: string) =>
  partial<EventCatalogEntry>()({ id, owningDomain })

const failuresOf = (manifests: ReadonlyArray<ModuleManifest>) => validateModuleRegistry(manifests)

describe("module registry", () => {
  it("accepts an acyclic set with declared dependencies and consumed events", () => {
    const orders = defineModule({
      ...empty,
      name: "orders",
      schemas: ["orders"],
      capabilities: { read: "orders.order.read" },
      events: [releasedEvent("orders", "orders.order.confirmed")],
      http: ["Orders"],
      pages: ["/orders"],
    })
    const mail = defineModule({
      ...empty,
      name: "mail",
      dependsOn: ["orders"],
      consumes: ["orders.order.confirmed"],
    })
    assert.deepStrictEqual(failuresOf([orders, mail]), [])
  })

  it("rejects unknown dependencies, cycles, and duplicate names", () => {
    const failures = failuresOf([
      { ...empty, name: "a", dependsOn: ["b"] },
      { ...empty, name: "b", dependsOn: ["a", "missing"] },
    ])
    assert.isTrue(failures.some((failure) => failure.includes("unknown module missing")))
    assert.isTrue(failures.some((failure) => failure.startsWith("module dependency cycle")))
    assert.isTrue(
      failuresOf([
        { ...empty, name: "a" },
        { ...empty, name: "a" },
      ]).some((failure) => failure.includes("registered twice")),
    )
  })

  it("rejects contracts outside the module's namespace", () => {
    const failures = failuresOf([
      {
        ...empty,
        name: "orders",
        capabilities: { read: "sales.order.read" },
        events: [releasedEvent("sales", "sales.order.confirmed")],
      },
    ])
    assert.isTrue(failures.some((failure) => failure.includes("must start with orders.")))
    assert.isTrue(failures.some((failure) => failure.includes("releases sales.order.confirmed")))
  })

  it("rejects shared ownership and consumption without a dependency", () => {
    const failures = failuresOf([
      { ...empty, name: "a", schemas: ["shared"], http: ["Same"] },
      { ...empty, name: "b", schemas: ["shared"], http: ["Same"], consumes: ["a.thing.done"] },
    ])
    assert.isTrue(failures.some((failure) => failure.includes("schema shared is declared")))
    assert.isTrue(failures.some((failure) => failure.includes("http Same is declared")))
    assert.isTrue(failures.some((failure) => failure.includes("no declared dependency releases")))
  })

  it("rejects invalid module names", () => {
    assert.isTrue(
      failuresOf([{ ...empty, name: "Bad-Name" }]).some((failure) =>
        failure.includes("must match"),
      ),
    )
  })
})
