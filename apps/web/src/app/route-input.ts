import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { definedFields } from "../shared/api.ts"

export function decodeRouteInput<S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  search: string,
  id?: string,
): S["Type"] | null {
  const decoded = Schema.decodeUnknownResult(schema)(
    {
      ...Object.fromEntries(new URLSearchParams(search)),
      ...definedFields({ id }),
    },
    { onExcessProperty: "error" },
  )

  return Result.isSuccess(decoded) ? decoded.success : null
}
