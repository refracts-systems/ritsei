import type { JSX } from "@solidjs/web"
import { omit } from "solid-js"
import { control } from "../recipes/control.ts"

type InputProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "class"> & {
  class?: JSX.ClassValue
}

export function Input(props: InputProps) {
  return <input {...omit(props, "class")} class={[control({ kind: "input" }), props.class]} />
}
