import { Dialog as KobalteDialog, useDialogContext } from "@kobalte/core/dialog"
import type { JSX } from "@solidjs/web"
import { createSignal, onSettled } from "solid-js"
import { css } from "../generated/css/index.js"
import { Icon } from "../icons/index.ts"
import { type ActionMenuRegistry, useActionMenu } from "./action-menu-context.ts"
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

function DialogBody(props: DialogProps & { menu: ActionMenuRegistry | null }) {
  const dialog = useDialogContext()
  return (
    <KobalteDialog.Content
      class={styles.content}
      onCloseAutoFocus={(event: Event) => {
        // A menu-launched dialog has no trigger button; return focus to the menu control.
        if (props.menu === null) return
        event.preventDefault()
        props.menu.restoreFocus()
      }}
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
  const menu = useActionMenu()
  // Uncontrolled dialogs inside an ActionMenu still need state the menu item can open.
  const [localOpen, setLocalOpen] = createSignal(false)
  const open = () => props.open ?? localOpen()
  const setOpen = (next: boolean) =>
    props.open === undefined ? setLocalOpen(next) : props.onOpenChange?.(next)
  onSettled(() => {
    if (menu === null || props.trigger === undefined) return
    return menu.register({ label: props.trigger, select: () => setOpen(true) })
  })
  return (
    <KobalteDialog
      modal
      {...(menu === null && props.open === undefined
        ? {}
        : { open: open(), onOpenChange: setOpen })}
    >
      {menu === null && props.trigger && (
        <KobalteDialog.Trigger as={Button} variant={props.triggerVariant} type="button">
          {props.trigger}
        </KobalteDialog.Trigger>
      )}
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay class={styles.overlay} />
        <DialogBody {...props} menu={menu} />
      </KobalteDialog.Portal>
    </KobalteDialog>
  )
}
