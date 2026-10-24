import * as Predicate from "effect/Predicate"
import type { FormValue } from "../ui/primitives/form.tsx"

/** A submitted text field, trimmed; empty when the field is absent or not text. */
export const formText = (value: FormValue[string] | undefined) =>
  Predicate.isString(value) ? value.trim() : ""

export const today = () => new Date().toISOString().slice(0, 10)

export const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
