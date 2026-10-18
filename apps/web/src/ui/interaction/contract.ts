export type InteractionSource = "pointer" | "keyboard" | "programmatic"

export type InteractionIntent =
  | {
      readonly type: "select"
      readonly targetId: string
      readonly source: InteractionSource
    }
  | {
      readonly type: "focus"
      readonly targetId: string
      readonly source: InteractionSource
    }
  | {
      readonly type: "dismiss"
      readonly targetId?: string
      readonly source: InteractionSource
    }
  | {
      readonly type: "move"
      readonly targetId: string
      readonly direction: "up" | "right" | "down" | "left"
      readonly source: InteractionSource
    }
