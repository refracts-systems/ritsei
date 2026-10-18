import { assert, describe, it } from "@effect/vitest"

import {
  applyDesignerAction,
  makeInitialDesignerModel,
  serializeProcessIr,
  setNodeCapability,
  validateDesignerModel,
} from "./designer-model.ts"

const withCommand = () =>
  applyDesignerAction(makeInitialDesignerModel(), { _tag: "add_node", kind: "DomainCommand" })
const configured = () =>
  setNodeCapability(withCommand(), "node-1", {
    kind: "DomainAction",
    id: "inventory.stock.adjust",
    version: 1,
  })

describe("Process Designer", () => {
  it("makes pointer and keyboard editing produce identical deterministic Process IR", () => {
    const initial = configured()
    const pointer = applyDesignerAction(initial, {
      _tag: "reorder_node",
      nodeId: "node-1",
      direction: "down",
    })
    const keyboard = applyDesignerAction(initial, {
      _tag: "reorder_node",
      nodeId: "node-1",
      direction: "down",
    })
    assert.strictEqual(
      serializeProcessIr({ ...pointer, formatVersion: 1, checksum: "same" }),
      serializeProcessIr({ ...keyboard, formatVersion: 1, checksum: "same" }),
    )
  })

  it("rejects missing capabilities and incompatible typed mappings", () => {
    assert.isTrue(
      validateDesignerModel(withCommand()).some((issue) => issue.code === "missing_capability"),
    )
    const invalidCapability = setNodeCapability(withCommand(), "node-1", {
      kind: "DomainEvent",
      id: "sales.order.confirmed",
      version: 1,
    })
    assert.isTrue(
      validateDesignerModel(invalidCapability).some((issue) => issue.code === "invalid_capability"),
    )
    const invalidVersion = setNodeCapability(withCommand(), "node-1", {
      kind: "DomainAction",
      id: "sales.order.confirm",
      version: Number.NaN,
    })
    assert.isTrue(
      validateDesignerModel(invalidVersion).some((issue) => issue.code === "missing_capability"),
    )
    const invalid = applyDesignerAction(configured(), {
      _tag: "add_mapping",
      nodeId: "node-1",
      mapping: {
        sourcePath: "order.id",
        targetPath: "stock.quantity",
        sourceType: "uuid",
        targetType: "number",
      },
    })
    assert.isTrue(validateDesignerModel(invalid).some((issue) => issue.code === "invalid_mapping"))
  })

  it("binds wait nodes to event catalog entries", () => {
    const wait = applyDesignerAction(makeInitialDesignerModel(), {
      _tag: "add_node",
      kind: "WaitForEvent",
    })
    assert.isTrue(validateDesignerModel(wait).some((issue) => issue.code === "missing_capability"))
    const configuredWait = setNodeCapability(wait, "node-1", {
      kind: "DomainEvent",
      id: "sales.order.confirmed",
      version: 1,
    })
    assert.deepStrictEqual(validateDesignerModel(configuredWait), [])
  })

  it("keeps structural endpoints unique", () => {
    const initial = makeInitialDesignerModel()

    assert.deepStrictEqual(
      applyDesignerAction(initial, { _tag: "add_node", kind: "Start" }),
      initial,
    )
    assert.deepStrictEqual(applyDesignerAction(initial, { _tag: "add_node", kind: "End" }), initial)
  })

  it("moves dragged nodes to the selected target", () => {
    let model = makeInitialDesignerModel()
    model = applyDesignerAction(model, { _tag: "add_node", kind: "DomainCommand" })
    model = applyDesignerAction(model, { _tag: "add_node", kind: "DomainCommand" })
    model = applyDesignerAction(model, { _tag: "add_node", kind: "DomainCommand" })
    const moved = applyDesignerAction(model, {
      _tag: "move_node",
      sourceId: "node-1",
      targetId: "node-3",
    })

    assert.deepStrictEqual(
      moved.nodes.map((node) => node.id),
      ["start", "node-2", "node-1", "node-3", "end"],
    )
  })

  it("accepts a configured linear draft", () => {
    assert.deepStrictEqual(validateDesignerModel(configured()), [])
  })
})
