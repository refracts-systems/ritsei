import { Dialog as KobalteDialog } from "@kobalte/core/dialog"
import { Button } from "../primitives/button.tsx"
import { Dialog } from "../primitives/dialog.tsx"

interface ConfirmDialogProps {
  readonly triggerLabel: string
  readonly triggerVariant?: "primary" | "secondary" | "ghost" | "danger"
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  readonly onConfirm: () => void
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <Dialog
      trigger={<span>{props.triggerLabel}</span>}
      triggerVariant={props.triggerVariant}
      title={props.title}
      description={props.description}
      footer={
        <>
          <KobalteDialog.CloseButton as={Button} type="button" aria-label="Cancel">
            Cancel
          </KobalteDialog.CloseButton>
          <KobalteDialog.CloseButton
            as={Button}
            variant={props.triggerVariant === "danger" ? "danger" : "primary"}
            type="button"
            aria-label={props.confirmLabel}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </KobalteDialog.CloseButton>
        </>
      }
    />
  )
}
