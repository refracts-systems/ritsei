import type { JSX } from "@solidjs/web"
import { createUniqueId, For, omit, Show } from "solid-js"
import { css } from "../../generated/css/index.js"
import type { MarkerTone, VisualIntent } from "../../grammar/visual-intent.ts"
import type { InteractionIntent } from "../../interaction/contract.ts"
import { motionStyles } from "../../motion/index.ts"
import {
  buildBoundaryPath,
  buildContourPaths,
  buildPulseRadius,
  buildRoutePath,
  cartographyViewBox,
} from "./paths.ts"

/**
 * USE WHEN: a typed visual projection needs a quiet HTML/SVG material layer.
 * DO NOT USE FOR: authoritative values, ordinary tables, business commands, or decoration.
 * REQUIRES: semantic labels, a textual fallback, and a projection-owned archetype mapping.
 * ACCESSIBILITY: the SVG is decorative; markers use native buttons when selection is enabled.
 * STATES: ready, loading, empty, error, and degraded are rendered with text/status messaging.
 * DENSITY: compact by default; the visual scales down to a single column on narrow screens.
 */
export interface CartographyFieldProps extends
  Omit<
    JSX.HTMLAttributes<HTMLElement>,
    "aria-busy" | "aria-describedby" | "aria-labelledby" | "children" | "class" | "role"
  >
{
  readonly intent: VisualIntent
  readonly selectedMarkerId?: string
  readonly onInteraction?: (intent: InteractionIntent) => void
  readonly children?: JSX.Element
  readonly class?: JSX.ClassValue
}

const styles = {
  root: css({
    display: "flex",
    flexDirection: { base: "column", lg: "row" },
    alignItems: "stretch",
    gap: "5",
    minWidth: "0",
    bg: "content",
    borderWidth: "1px",
    borderColor: "boundary",
    borderRadius: "sm",
    p: "5",
  }),
  visual: css({
    position: "relative",
    flex: "1",
    minWidth: "0",
    minHeight: "40",
    overflow: "hidden",
    bg: "canvas",
    borderWidth: "1px",
    borderColor: "boundary",
    borderRadius: "sm",
  }),
  svg: css({ display: "block", width: "full", height: "full", minHeight: "40" }),
  field: css({ fill: "canvas" }),
  contours: css({ stroke: "boundary" }),
  route: css({ stroke: "action" }),
  boundary: css({ stroke: "muted" }),
  pulse: css({ stroke: "action" }),
  summary: css({
    display: "flex",
    flexDirection: "column",
    gap: "3",
    minWidth: "0",
    maxWidth: "sm",
  }),
  label: css({ textStyle: "label", color: "text" }),
  description: css({ textStyle: "bodyCompact", color: "muted", m: "0" }),
  status: css({ textStyle: "helper", color: "muted", m: "0" }),
  error: css({ textStyle: "helper", color: "danger", m: "0" }),
  metrics: css({ display: "flex", flexDirection: "column", gap: "2", m: "0" }),
  metric: css({ display: "flex", justifyContent: "space-between", gap: "3", m: "0" }),
  metricLabel: css({ textStyle: "metadata", color: "muted" }),
  metricValue: css({ textStyle: "numeric", color: "text", m: "0" }),
  marker: css({
    position: "absolute",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "10",
    height: "10",
    p: "0",
    borderWidth: "2px",
    borderRadius: "full",
    transform: "translate(-50%, -50%)",
    cursor: "pointer",
    _focusVisible: {
      outline: "[3px solid]",
      outlineColor: "action",
      outlineOffset: "[2px]",
    },
  }),
  markerDot: css({
    position: "absolute",
    width: "3",
    height: "3",
    borderWidth: "1px",
    borderRadius: "full",
    transform: "translate(-50%, -50%)",
    pointerEvents: "none",
  }),
  markerNeutral: css({ bg: "content", borderColor: "boundary" }),
  markerInfo: css({ bg: "content", borderColor: "icon.info" }),
  markerSuccess: css({ bg: "content", borderColor: "icon.success" }),
  markerWarning: css({ bg: "content", borderColor: "icon.warning" }),
  markerDanger: css({ bg: "content", borderColor: "danger" }),
  compact: css({ p: "4" }),
  dense: css({ p: "3", gap: "4" }),
}

const densityStyles = {
  comfortable: undefined,
  compact: styles.compact,
  dense: styles.dense,
} as const

const markerStyles: Readonly<Record<MarkerTone, string>> = {
  neutral: styles.markerNeutral,
  info: styles.markerInfo,
  success: styles.markerSuccess,
  warning: styles.markerWarning,
  danger: styles.markerDanger,
}

const statusMessage = (intent: VisualIntent): string => {
  switch (intent.status) {
    case "loading":
      return "Loading visual summary…"
    case "empty":
      return "There is no data to project yet."
    case "error":
      return "The visual summary is unavailable. Use the data table or retry the source request."
    case "degraded":
      return "Simplified visual mode is active; the text summary remains available."
    case "ready":
      return ""
  }
}

const markerPosition = (marker: { readonly x: number; readonly y: number }) => ({
  left: `${marker.x}%`,
  top: `${marker.y}%`,
})

export function CartographyField(props: CartographyFieldProps) {
  const id = createUniqueId()
  const labelId = `${id}-label`
  const descriptionId = `${id}-description`
  const rootProps = omit(props, "intent", "selectedMarkerId", "onInteraction", "class", "children")
  const hasScene = () => props.intent.status === "ready" || props.intent.status === "degraded"
  const contourPaths = () => hasScene() ? buildContourPaths(props.intent) : []
  const routePath = () => hasScene() ? buildRoutePath(props.intent) : undefined
  const boundaryPath = () => hasScene() ? buildBoundaryPath(props.intent) : undefined
  const animated = () => hasScene() && props.intent.motion !== "static"
  const visibleMetrics = () => props.intent.fallback.metrics ?? []

  return (
    <section
      {...rootProps}
      class={[styles.root, densityStyles[props.intent.density], props.class]}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      aria-busy={props.intent.status === "loading" ? "true" : undefined}
      data-archetypes={props.intent.archetypes.join(" ")}
      data-density={props.intent.density}
      data-status={props.intent.status}
      data-surface={props.intent.surface}
    >
      <div class={styles.visual}>
        <svg
          class={[styles.svg, animated() && motionStyles.enterSubtle]}
          viewBox={`0 0 ${cartographyViewBox.width} ${cartographyViewBox.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect
            class={styles.field}
            x="0"
            y="0"
            width={cartographyViewBox.width}
            height={cartographyViewBox.height}
          />
          <Show when={hasScene()}>
            <Show when={boundaryPath()}>
              {(path) => (
                <path
                  class={styles.boundary}
                  d={path()}
                  fill="none"
                  stroke-width="1"
                  opacity={0.7 - props.intent.material.boundarySoftness * 0.25}
                />
              )}
            </Show>
            <g
              class={styles.contours}
              stroke-width={1 + props.intent.material.density}
              opacity={0.42 + props.intent.material.density * 0.32}
            >
              <For each={contourPaths()}>{(path) => <path d={path} fill="none" />}</For>
            </g>
            <Show when={routePath()}>
              {(path) => (
                <path
                  class={styles.route}
                  d={path()}
                  fill="none"
                  stroke-width={1.5 + props.intent.material.velocity}
                  stroke-dasharray={props.intent.material.velocity > 0.2 ? "6 5" : undefined}
                  opacity={0.65 + props.intent.material.velocity * 0.25}
                />
              )}
            </Show>
            <Show when={props.intent.material.pulse > 0}>
              <circle
                class={[styles.pulse, animated() && motionStyles.enterSubtle]}
                cx="270"
                fill="none"
                cy="52"
                r={buildPulseRadius(props.intent)}
                stroke-width="2"
                opacity={0.35 + props.intent.material.pulse * 0.35}
              />
            </Show>
          </Show>
        </svg>
        <For each={hasScene() ? props.intent.markers : []}>
          {(marker) => {
            const className = [
              props.onInteraction ? styles.marker : styles.markerDot,
              markerStyles[marker.tone ?? "neutral"],
            ]
            return props.onInteraction
              ? (
                <button
                  class={className}
                  type="button"
                  style={markerPosition(marker)}
                  aria-label={marker.label}
                  aria-pressed={props.selectedMarkerId === marker.id ? "true" : "false"}
                  data-marker-id={marker.id}
                  data-selected={props.selectedMarkerId === marker.id ? "true" : undefined}
                  onClick={(event) => {
                    props.onInteraction?.({
                      type: "select",
                      targetId: marker.id,
                      source: event.detail === 0 ? "keyboard" : "pointer",
                    })
                  }}
                />
              )
              : <span class={className} style={markerPosition(marker)} aria-hidden="true" />
          }}
        </For>
      </div>
      <div class={styles.summary}>
        <span id={labelId} class={styles.label}>{props.intent.semantics.label}</span>
        <p id={descriptionId} class={styles.description}>{props.intent.semantics.description}</p>
        <p class={styles.description}>{props.intent.fallback.summary}</p>
        <Show when={statusMessage(props.intent)}>
          <p
            class={props.intent.status === "error" ? styles.error : styles.status}
            role={props.intent.status === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {statusMessage(props.intent)}
          </p>
        </Show>
        <dl class={styles.metrics}>
          <For each={visibleMetrics()}>
            {(metric) => (
              <div class={styles.metric}>
                <dt class={styles.metricLabel}>{metric.label}</dt>
                <dd class={styles.metricValue}>{metric.value}</dd>
              </div>
            )}
          </For>
        </dl>
      </div>
      {props.children}
    </section>
  )
}
