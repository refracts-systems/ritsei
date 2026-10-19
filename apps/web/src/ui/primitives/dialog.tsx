import {
  Dialog as KobalteDialog,
  type DialogContextValue,
  useDialogContext,
} from "@kobalte/core/dialog"
import type { JSX } from "@solidjs/web"
import { createEffect } from "solid-js"
import { css } from "../generated/css/index.js"
import { Icon } from "../icons/index.ts"
import { Button } from "./button.tsx"

export const createDialogOpenChange =
  (
    mutation: { readonly isPending: boolean; readonly reset: () => void },
    setOpen: (open: boolean) => void,
    resetField?: (invalid: boolean) => void,
    afterReset?: () => void,
  ) =>
  // Fallow: this helper intentionally centralizes pending guards and dialog reset branches.
  // fallow-ignore-next-line complexity
  (next: boolean) => {
    if (mutation.isPending) return
    if (next) {
      mutation.reset()
      resetField?.(false)
      afterReset?.()
    }
    setOpen(next)
  }

export interface DialogProps {
  readonly trigger?: JSX.Element
  readonly triggerVariant?: "primary" | "secondary" | "ghost" | "danger"
  readonly title: string
  readonly description?: string
  readonly children?: JSX.Element
  readonly footer?: JSX.Element
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
}

const styles = {
  overlay: css({
    position: "fixed",
    inset: "0",
    zIndex: "modal",
    bg: "backdrop",
  }),
  content: css({
    position: "fixed",
    top: "[50%]",
    left: "[50%]",
    zIndex: "modal",
    width: "dialog",
    maxWidth: "[34rem]",
    maxHeight: "[calc(100dvh - 2rem)]",
    overflow: "auto",
    transform: "translate(-50%, -50%)",
    bg: "content",
    color: "text",
    borderWidth: "1px",
    borderColor: "boundary",
    borderRadius: "overlay",
    p: "6",
    boxShadow: "overlay",
  }),
  close: css({ position: "absolute", top: "4", right: "4" }),
  body: css({ display: "flex", flexDirection: "column", gap: "4" }),
  title: css({ textStyle: "sectionTitle", fontSize: "lg", lineHeight: "lg", pr: "10" }),
  description: css({ color: "muted", textStyle: "bodyCompact", mt: "-2" }),
  footer: css({
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: "2",
    mt: "6",
    pt: "4",
    borderTopWidth: "1px",
    borderColor: "boundary",
  }),
}

/**
 * Kobalte's focus trap moves initial focus two animation frames after mount. Focus the dialog
 * container as soon as it is committed so focus never stays outside an open modal dialog; the
 * trap then moves it to the first tabbable element as before.
 */
export function useDialogInitialFocus(dialog: DialogContextValue) {
  createEffect(
    () => (dialog.isOpen() ? dialog.contentRef() : undefined),
    (content) => {
      if (content && !content.contains(document.activeElement))
        content.focus({ preventScroll: true })
    },
  )
}

function DialogBody(props: DialogProps) {
  const dialog = useDialogContext()
  useDialogInitialFocus(dialog)
  return (
    <KobalteDialog.Content
      class={styles.content}
      onEscapeKeyDown={() => dialog.close()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          dialog.close()
        }
      }}
    >
      <KobalteDialog.CloseButton
        as={Button}
        class={styles.close}
        iconOnly
        variant="ghost"
        size="sm"
        aria-label="Close"
        type="button"
      >
        <Icon name="action.close" size="sm" />
      </KobalteDialog.CloseButton>
      <div class={styles.body}>
        <KobalteDialog.Title class={styles.title}>{props.title}</KobalteDialog.Title>
        {props.description && (
          <KobalteDialog.Description class={styles.description}>
            {props.description}
          </KobalteDialog.Description>
        )}
        {props.children}
      </div>
      {props.footer && <div class={styles.footer}>{props.footer}</div>}
    </KobalteDialog.Content>
  )
}

export function Dialog(props: DialogProps) {
  return (
    <KobalteDialog
      modal
      {...(props.open === undefined ? {} : { open: props.open, onOpenChange: props.onOpenChange })}
    >
      {props.trigger && (
        <KobalteDialog.Trigger as={Button} variant={props.triggerVariant} type="button">
          {props.trigger}
        </KobalteDialog.Trigger>
      )}
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay class={styles.overlay} />
        <DialogBody {...props} />
      </KobalteDialog.Portal>
    </KobalteDialog>
  )
}
