import type { JSX } from "@solidjs/web"
import { omit } from "solid-js"

export type FormValue = Record<string, FormDataEntryValue>

export type FormProps = Omit<JSX.FormHTMLAttributes<HTMLFormElement>, "class" | "onSubmit"> & {
  class?: JSX.ClassValue
  onSubmit: (value: FormValue, event: SubmitEvent, data: FormData) => void | Promise<void>
}

/** A native form shell; callers may decode the submitted value with Effect Schema. */
export function Form(props: FormProps) {
  const formProps = omit(props, "class", "onSubmit", "children")

  return (
    <form
      {...formProps}
      class={props.class}
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void props.onSubmit(Object.fromEntries(data), event, data)
      }}
    >
      {props.children}
    </form>
  )
}
