import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import { readFileSync } from "node:fs"
import pandaConfig from "../../apps/web/panda.config.ts"

type Pair = readonly [string, string]

const TokensFile = Schema.Struct({
  adopted: Schema.Struct({
    color: Schema.Record(Schema.String, Schema.Tuple([Schema.String, Schema.String])),
  }),
})

const tokensFile = Schema.decodeUnknownSync(TokensFile)(
  JSON.parse(readFileSync("docs/design/kontainer/tokens.json", "utf8")),
)

// A themed semantic color, a group of them (icon), or a group of groups (status).
const Leaf = Schema.Struct({ value: Schema.Struct({ base: Schema.String, _dark: Schema.String }) })
const Group = Schema.Record(Schema.String, Leaf)

const Colors = Schema.Record(
  Schema.String,
  Schema.Union([Leaf, Group, Schema.Record(Schema.String, Group)]),
)

const isLeaf = Schema.is(Leaf)
const isGroup = Schema.is(Group)

/** The semantic color tokens of the stylesheet, as `name -> [light, dark]`. */
const shipped = (): ReadonlyMap<string, Pair> => {
  const found = new Map<string, Pair>()

  const add = (name: string, leaf: typeof Leaf.Type) =>
    found.set(name, [leaf.value.base, leaf.value._dark])

  const colors = Schema.decodeUnknownSync(Colors)(pandaConfig.theme?.extend?.semanticTokens?.colors)

  for (const [name, node] of Object.entries(colors)) {
    if (isLeaf(node)) add(name, node)
    else if (isGroup(node))
      for (const [key, leaf] of Object.entries(node)) add(`${name}.${key}`, leaf)
    else {
      for (const [group, members] of Object.entries(node)) {
        for (const [key, leaf] of Object.entries(members)) add(`${name}.${group}.${key}`, leaf)
      }
    }
  }

  return found
}

const luminance = (hex: string) => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (foreground: string, background: string) => {
  const [lighter = 0, darker = 0] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  )

  return (lighter + 0.05) / (darker + 0.05)
}

const surfaces = ["canvas", "content", "contentSubtle", "contentHover", "contentActive"]

const themes = [
  ["light", 0],
  ["dark", 1],
] as const

describe("design tokens", () => {
  // The reference file is edited by hand with an ADR, so a mismatch is a real drift, not a stale copy.
  it("keeps the stylesheet's colors equal to the adopted tokens file", () => {
    const byName = (entries: Iterable<readonly [string, Pair]>) =>
      [...entries].sort(([a], [b]) => a.localeCompare(b))

    assert.deepEqual(byName(shipped().entries()), byName(Object.entries(tokensFile.adopted.color)))
  })

  for (const [theme, index] of themes) {
    describe(`in the ${theme} theme`, () => {
      const color = (name: string) => shipped().get(name)?.[index] ?? ""

      it("keeps text, secondary text, links, and the focus ring readable on every surface", () => {
        for (const surface of surfaces) {
          for (const foreground of ["text", "muted", "link"]) {
            const ratio = contrast(color(foreground), color(surface))

            assert.isAtLeast(ratio, 4.5, `${foreground} on ${surface} is ${ratio.toFixed(2)}`)
          }

          const ring = contrast(color("focusRing"), color(surface))

          assert.isAtLeast(ring, 3, `focusRing on ${surface} is ${ring.toFixed(2)}`)
        }
      })

      it("keeps the surface frame, and the light text on every object type, above their minimums", () => {
        for (const surface of ["canvas", "content"]) {
          const frame = contrast(color("frame"), color(surface))

          assert.isAtLeast(frame, 3, `frame on ${surface} is ${frame.toFixed(2)}`)
        }

        for (const type of ["sal", "prc", "inv", "fin", "hrd"]) {
          const ratio = contrast(color("onType"), color(`type.${type}`))

          assert.isAtLeast(ratio, 4.5, `onType on type.${type} is ${ratio.toFixed(2)}`)
        }
      })

      it("keeps input borders, commands, and status text above their minimums", () => {
        for (const surface of ["canvas", "content"]) {
          const border = contrast(color("boundaryStrong"), color(surface))

          assert.isAtLeast(border, 3, `boundaryStrong on ${surface} is ${border.toFixed(2)}`)
        }

        for (const [text, fill] of [
          ["onAction", "action"],
          ["onAction", "actionHover"],
          ["onDanger", "danger"],
        ] as const) {
          const ratio = contrast(color(text), color(fill))

          assert.isAtLeast(ratio, 4.5, `${text} on ${fill} is ${ratio.toFixed(2)}`)
        }

        for (const tone of ["neutral", "success", "warning", "danger", "info"]) {
          const ratio = contrast(color(`status.${tone}.fg`), color(`status.${tone}.bg`))

          assert.isAtLeast(ratio, 4.5, `status ${tone} is ${ratio.toFixed(2)}`)
        }
      })
    })
  }
})
