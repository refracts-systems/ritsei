import { assert, it } from "@effect/vitest"

import { uuidv7 } from "../mod.ts"

it("generates RFC 9562 UUIDv7 values", () => {
  const id = uuidv7()

  assert.isTrue(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
})
