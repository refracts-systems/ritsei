import { assert, it } from "@effect/vitest"
import pandaConfig from "../../apps/web/panda.config.ts"
import { motionDuration, motionEasing, semanticMotion } from "../../apps/web/src/ui/motion/index.ts"

it("never eases in and never runs interface motion past 320ms", () => {
  // An ease-in curve starts flat: its first control point sits on the time axis (y1 = 0) away
  // from the origin. Ease-in-out is allowed only for things that move while staying on screen.
  for (const [name, [x1, y1]] of Object.entries(motionEasing)) {
    if (name !== "inOut") assert.isFalse(x1 > 0 && y1 === 0, `${name} eases in`)
  }

  for (const duration of Object.values(motionDuration)) assert.isTrue(duration <= 320)

  // Leaving is quicker than arriving.
  assert.isTrue(semanticMotion.exit.duration < semanticMotion.enter.duration)
})

it("keeps the stylesheet's motion tokens equal to the runtime tokens", () => {
  const tokens = pandaConfig.theme?.extend?.tokens

  // The spinner's turn is a loop and `linear` is a keyword; neither is interface motion.
  const { spin: _spin, ...durations } = tokens?.durations ?? {}
  const { linear: _linear, ...easings } = tokens?.easings ?? {}

  assert.deepEqual(
    durations,
    Object.fromEntries(
      Object.entries(motionDuration).map(([name, value]) => [name, { value: `${value}ms` }]),
    ),
  )
  assert.deepEqual(
    easings,
    Object.fromEntries(
      Object.entries(motionEasing).map(([name, points]) => [
        name,
        { value: `cubic-bezier(${points.join(", ")})` },
      ]),
    ),
  )
})
