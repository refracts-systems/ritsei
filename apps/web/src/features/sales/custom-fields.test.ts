import { assert, describe, it } from "@effect/vitest"
import {
  type CustomFieldDefinition,
  definitionPayload,
  displayValue,
  listOptions,
  valuesPayload,
} from "./custom-fields.ts"

const definition = (
  key: string,
  kind: CustomFieldDefinition["kind"],
  choices: readonly string[] | null = null,
): CustomFieldDefinition => ({
  id: "01900000-0000-7000-8000-000000000001",
  key,
  label: key,
  kind,
  required: false,
  choices,
  position: 0,
})

describe("definitionPayload", () => {
  it("builds a definition from the form", () => {
    assert.deepStrictEqual(
      definitionPayload({
        key: "tier",
        label: " Tier ",
        kind: "choice",
        choices: "gold, silver ,,",
      }),
      { key: "tier", label: "Tier", kind: "choice", choices: ["gold", "silver"] },
    )
    assert.deepStrictEqual(
      definitionPayload({ key: "notes", label: "Notes", kind: "text", required: "true" }),
      { key: "notes", label: "Notes", kind: "text", required: true },
    )
  })

  it("rejects a malformed key, a blank label, and a choice field without choices", () => {
    assert.isUndefined(definitionPayload({ key: "Tier", label: "Tier", kind: "text" }))
    assert.isUndefined(definitionPayload({ key: "tier", label: " ", kind: "text" }))
    assert.isUndefined(definitionPayload({ key: "tier", label: "Tier", kind: "choice" }))
    assert.isUndefined(definitionPayload({ key: "tier", label: "Tier", kind: "unknown" }))
  })
})

describe("valuesPayload", () => {
  const definitions = [
    definition("tier", "choice", ["gold", "silver"]),
    definition("fragile", "boolean"),
    definition("notes", "text"),
  ]

  it("sends only what changed, and null for a field that was emptied", () => {
    assert.deepStrictEqual(
      valuesPayload(
        { "field-tier": "silver", "field-fragile": "true", "field-notes": "" },
        definitions,
        { tier: "gold", fragile: true, notes: "old" },
      ),
      { tier: "silver", notes: null },
    )
  })

  it("sends nothing when nothing changed", () => {
    assert.deepStrictEqual(
      valuesPayload({ "field-tier": "gold", "field-fragile": "", "field-notes": "" }, definitions, {
        tier: "gold",
      }),
      {},
    )
  })

  it("reads a boolean as true or false", () => {
    assert.deepStrictEqual(
      valuesPayload({ "field-fragile": "false" }, [definition("fragile", "boolean")], {}),
      { fragile: false },
    )
  })
})

describe("listOptions and displayValue", () => {
  it("offers yes or no, the choices, or nothing", () => {
    assert.deepStrictEqual(
      listOptions(definition("fragile", "boolean")).map((option) => option.label),
      ["Yes", "No"],
    )
    assert.deepStrictEqual(listOptions(definition("tier", "choice", ["gold"])), [
      { value: "gold", label: "gold" },
    ])
    assert.isUndefined(listOptions(definition("notes", "text")))
  })

  it("shows what is stored in words", () => {
    assert.strictEqual(displayValue(null), "Not set")
    assert.strictEqual(displayValue(undefined), "Not set")
    assert.strictEqual(displayValue(true), "Yes")
    assert.strictEqual(displayValue(false), "No")
    assert.strictEqual(displayValue("gold"), "gold")
  })
})
