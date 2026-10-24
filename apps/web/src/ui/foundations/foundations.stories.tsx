import { createSignal, onCleanup } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Icon } from "../icons/index.ts"
import { animateSpatial } from "../motion/animate.ts"
import { motionStyles } from "../motion/styles.ts"
import { Button } from "../primitives/button.tsx"
import { control } from "../recipes/control.ts"
import { surface } from "../recipes/surface.ts"
import { layout } from "./layout.ts"
import { typography } from "./typography.ts"

function MotionDemo() {
  let node: HTMLDivElement | undefined
  let animation: ReturnType<typeof animateSpatial> | undefined
  const [offset, setOffset] = createSignal(0)

  const move = () => {
    if (!node) return
    const next = offset() === 0 ? 24 : 0
    animation?.stop()
    animation = animateSpatial(node, { x: next })
    setOffset(next)
  }

  onCleanup(() => animation?.stop())

  return (
    <div class={layout.stack}>
      <div class={layout.row}>
        <Button variant="primary" type="button" onClick={move}>
          Move spatially
        </Button>
        <span aria-live="polite">Offset: {offset()}px</span>
      </div>
      <div
        class={motionStyles.enterSubtle}
        ref={(element) => (node = element)}
        style="width:48px;height:48px;border-radius:8px;background-color:var(--colors-action)"
      />
    </div>
  )
}

function ButtonStateDemo() {
  const [active, setActive] = createSignal(false)

  return (
    <div class={layout.stack}>
      <Button
        type="button"
        aria-pressed={active() ? "true" : "false"}
        onClick={() => setActive(!active())}
      >
        {active() ? "Enabled" : "Enable"} notifications
      </Button>
      <span aria-live="polite">Notifications: {active() ? "on" : "off"}</span>
    </div>
  )
}

function FoundationsStory() {
  return (
    <main class={layout.main}>
      <div class={layout.stack}>
        <header class={layout.stack}>
          <p class={layout.notice}>RITSEI shared UI</p>
          <h1>Foundation recipes</h1>
          <p>Semantic controls and surfaces stay usable in light and dark themes.</p>
        </header>

        <section class={surface()} aria-labelledby="typography-heading">
          <div class={layout.stack}>
            <h2 id="typography-heading">Typography</h2>
            <p class={typography.display}>Operational clarity</p>
            <p class={typography.body}>
              Pretendard carries product information; IBM Plex Mono is reserved for identifiers and
              technical values.
            </p>
            <p class={typography.metadata}>Metadata · 2026-09-05 · reviewed</p>
            <p class={typography.code}>INV-2026-001289</p>
            <p class={typography.numeric}>Rp 204.517.500</p>
          </div>
        </section>

        <section class={surface()} aria-labelledby="icons-heading">
          <div class={layout.stack}>
            <h2 id="icons-heading">Iconography</h2>
            <div class={layout.row}>
              <span>
                <Icon name="action.add" /> Create
              </span>
              <span>
                <Icon name="action.refresh" size="sm" /> Refresh
              </span>
              <span>
                <Icon name="status.warning" tone="warning" /> Needs review
              </span>
              <span>
                <Icon name="object.invoice" variant="duotone" size="display" />
              </span>
            </div>
          </div>
        </section>

        <section class={surface()} aria-labelledby="motion-heading">
          <div class={layout.stack}>
            <h2 id="motion-heading">Motion</h2>
            <MotionDemo />
            <p class={typography.metadata}>
              Runtime geometry uses the design-system Motion wrapper; state remains in Solid.
            </p>
          </div>
        </section>

        <section class={surface()} aria-labelledby="actions-heading">
          <div class={layout.stack}>
            <h2 id="actions-heading">Actions</h2>
            <div class={layout.row}>
              <Button variant="secondary" type="button">
                Save changes
              </Button>
              <Button variant="primary" type="button">
                Primary action
              </Button>
              <Button variant="primary" type="button" disabled>
                Disabled action
              </Button>
            </div>
            <ButtonStateDemo />
          </div>
        </section>

        <section class={surface()} aria-labelledby="inputs-heading">
          <div class={layout.stack}>
            <h2 id="inputs-heading">Inputs</h2>
            <label class={layout.stack} for="email">
              <span>Email address</span>
              <input
                class={control({ kind: "input" })}
                id="email"
                name="email"
                type="email"
                value="operator@example.com"
              />
            </label>
          </div>
        </section>
      </div>
    </main>
  )
}

const meta = {
  title: "UI/Foundations",
  component: FoundationsStory,
} satisfies Meta<typeof FoundationsStory>

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
