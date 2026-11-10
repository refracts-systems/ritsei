import { defineAnimationStyles, defineConfig, definePreset } from "@pandacss/dev"
import pandaPreset from "@pandacss/preset-panda"

// The stock preset minus what RITSEI does not use: its ~240-variable color palette, blurs, aspect
// ratios, shadows, and animations, and the font, type, radius, duration, and easing scales that
// RITSEI defines itself below. Spacing and sizes keep only the steps of the 4px grid in reach.
// Every token ships as a CSS variable whether used or not, so this is what keeps the stylesheet
// inside its 50 KB budget (ADR-0090). A missing step is a type error, not a silent fallback.
const {
  blurs: _blurs,
  aspectRatios: _aspectRatios,
  animations: _animations,
  shadows: _shadows,
  fonts: _fonts,
  fontSizes: _fontSizes,
  fontWeights: _fontWeights,
  lineHeights: _lineHeights,
  letterSpacings: _letterSpacings,
  radii: _radii,
  durations: _durations,
  easings: _easings,
  spacing: presetSpacing = {},
  sizes: presetSizes = {},
  ...presetTokens
} = pandaPreset.theme?.tokens ?? {}

// Named steps (`full`, `md`, `fit`) stay; numbered steps stop at 5rem.
const withinReach = <Scale extends object>(scale: Scale) =>
  Object.fromEntries(Object.entries(scale).filter(([step]) => !(Number(step) > 20)))

const ritseiBasePreset = definePreset({
  ...pandaPreset,
  name: "ritsei-base",
  theme: {
    ...pandaPreset.theme,
    keyframes: {},
    tokens: {
      ...presetTokens,
      spacing: withinReach(presetSpacing),
      sizes: withinReach(presetSizes),
      colors: {
        transparent: { value: "transparent" },
        current: { value: "currentColor" },
      },
    },
  },
})

// Overlays animate in and leave at once: the pinned Kobalte alpha unmounts a closed overlay
// immediately, so an exit animation would never be seen.
const motionAnimationStyles = defineAnimationStyles({
  "enter-subtle": {
    value: {
      animationName: "enter-subtle",
      animationDuration: "normal",
      animationTimingFunction: "out",
      animationFillMode: "both",
      _motionReduce: {
        animationName: "fade-in",
        animationDuration: "instant",
        animationTimingFunction: "linear",
      },
    },
  },
  "fade-in": {
    value: {
      animationName: "fade-in",
      animationDuration: "normal",
      animationTimingFunction: "out",
      animationFillMode: "both",
    },
  },
  // Scale and fade from the element's transform origin: the center for a dialog, the trigger for a
  // menu. Never from scale(0): nothing appears out of nothing.
  "pop-in": {
    value: {
      animationName: "pop-in",
      animationDuration: "normal",
      animationTimingFunction: "out",
      animationFillMode: "both",
      _motionReduce: { animationName: "fade-in" },
    },
  },
})

// Semantic color pair: [light, dark]. Values are owned by docs/architecture/design-system.md §8.
const pair = (base: string, dark: string) => ({ value: { base, _dark: dark } })

export default defineConfig({
  presets: ["@pandacss/preset-base", ritseiBasePreset],
  jsxFramework: "solid",
  preflight: true,
  strictTokens: true,
  include: ["./src/ui/**/*.{ts,tsx}"],
  exclude: ["./src/ui/generated/**"],
  outdir: "src/ui/generated",
  outExtension: "js",
  conditions: {
    dark: "[data-theme=dark] &",
    // A touch screen reports hover on tap and leaves it stuck, so hover styles apply only where a
    // pointer can really hover.
    hover: ["@media (hover: hover) and (pointer: fine)", "&:is(:hover, [data-hover])"],
  },
  theme: {
    extend: {
      tokens: {
        colors: {
          // Primitive palettes. Feature code never consumes these directly.
          neutral: {
            0: { value: "#FFFFFF" },
            50: { value: "#FAFAFA" },
            100: { value: "#F4F4F5" },
            150: { value: "#EDEDEF" },
            200: { value: "#E4E4E7" },
            300: { value: "#D4D4D8" },
            400: { value: "#A1A1AA" },
            450: { value: "#8B8B94" },
            500: { value: "#71717A" },
            550: { value: "#6A6A72" },
            600: { value: "#52525B" },
            750: { value: "#2E2E33" },
            800: { value: "#27272A" },
            825: { value: "#232327" },
            850: { value: "#1F1F23" },
            900: { value: "#18181B" },
            925: { value: "#131316" },
            950: { value: "#09090B" },
          },
          cobalt: {
            50: { value: "#EEF2FF" },
            300: { value: "#A9BCFF" },
            500: { value: "#7C9BFF" },
            600: { value: "#2E52D6" },
            700: { value: "#2442B0" },
            900: { value: "#1B2440" },
          },
        },
        fonts: {
          body: {
            value:
              '"Pretendard Variable", "Pretendard", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          },
          mono: {
            value: '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Consolas, monospace',
          },
        },
        fontSizes: {
          xs: { value: "12px" },
          sm: { value: "13px" },
          md: { value: "14px" },
          lg: { value: "16px" },
          xl: { value: "18px" },
          "2xl": { value: "20px" },
          "3xl": { value: "24px" },
          "4xl": { value: "32px" },
          iconXs: { value: "14px" },
          iconSm: { value: "16px" },
          iconMd: { value: "18px" },
          iconLg: { value: "20px" },
          iconXl: { value: "24px" },
          iconDisplay: { value: "32px" },
        },
        fontWeights: {
          regular: { value: "400" },
          medium: { value: "500" },
          semibold: { value: "600" },
        },
        lineHeights: {
          none: { value: "1" },
          xs: { value: "16px" },
          sm: { value: "18px" },
          md: { value: "20px" },
          lg: { value: "24px" },
          xl: { value: "26px" },
          "2xl": { value: "28px" },
          "3xl": { value: "32px" },
          "4xl": { value: "40px" },
        },
        letterSpacings: {
          display: { value: "-0.02em" },
          heading: { value: "-0.006em" },
          normal: { value: "0" },
          label: { value: "0.04em" },
        },
        sizes: {
          iconXs: { value: "14px" },
          iconSm: { value: "16px" },
          iconMd: { value: "18px" },
          iconLg: { value: "20px" },
          iconXl: { value: "24px" },
          iconDisplay: { value: "32px" },
          dialog: { value: "calc(100% - 2rem)" },
          shellViewport: { value: "100dvh" },
          sidebar: { value: "15rem" },
          topbar: { value: "3rem" },
        },
        // Nested radii step down by the padding between them (a 10px menu with 4px padding holds
        // 6px items), so inner and outer corners stay concentric.
        radii: {
          xs: { value: "2px" },
          item: { value: "6px" },
          control: { value: "8px" },
          menu: { value: "10px" },
          surface: { value: "12px" },
          overlay: { value: "14px" },
          panel: { value: "14px" },
          full: { value: "9999px" },
        },
        zIndex: {
          base: { value: "0" },
          sticky: { value: "100" },
          modal: { value: "1100" },
          skipLink: { value: "1200" },
        },
        // Durations and curves mirror ui/motion/tokens.ts, which the runtime wrapper reads. A config
        // may not import UI internals, so tests/frontend/motion.test.ts keeps the two equal and
        // enforces the rules: no ease-in, nothing past 320ms.
        durations: {
          none: { value: "0ms" },
          instant: { value: "80ms" },
          fast: { value: "120ms" },
          press: { value: "160ms" },
          normal: { value: "180ms" },
          deliberate: { value: "240ms" },
          slow: { value: "320ms" },
          // One turn of the loading spinner: a loop, not a transition.
          spin: { value: "600ms" },
        },
        easings: {
          linear: { value: "linear" },
          // Hover and color changes.
          standard: { value: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
          // Anything entering, leaving, or answering a press.
          out: { value: "cubic-bezier(0.23, 1, 0.32, 1)" },
          // Something already on screen that moves or changes size.
          inOut: { value: "cubic-bezier(0.77, 0, 0.175, 1)" },
          // The navigation drawer.
          drawer: { value: "cubic-bezier(0.32, 0.72, 0, 1)" },
        },
      },
      semanticTokens: {
        colors: {
          // Surfaces
          backdrop: pair("rgba(9, 9, 11, 0.5)", "rgba(0, 0, 0, 0.7)"),
          canvas: pair("{colors.neutral.50}", "{colors.neutral.950}"),
          content: pair("{colors.neutral.0}", "{colors.neutral.925}"),
          contentSubtle: pair("{colors.neutral.50}", "{colors.neutral.900}"),
          contentHover: pair("{colors.neutral.100}", "{colors.neutral.850}"),
          contentActive: pair("{colors.neutral.150}", "{colors.neutral.800}"),
          // Text
          text: pair("{colors.neutral.900}", "{colors.neutral.150}"),
          muted: pair("{colors.neutral.550}", "{colors.neutral.400}"),
          // Borders
          boundary: pair("{colors.neutral.200}", "{colors.neutral.825}"),
          boundaryControl: pair("{colors.neutral.300}", "{colors.neutral.750}"),
          boundaryStrong: pair("{colors.neutral.450}", "{colors.neutral.500}"),
          // Commands: ink, not the accent.
          action: pair("{colors.neutral.900}", "{colors.neutral.50}"),
          actionHover: pair("{colors.neutral.750}", "{colors.neutral.200}"),
          onAction: pair("{colors.neutral.50}", "{colors.neutral.900}"),
          // The one accent: links, focus, and selection.
          accent: pair("{colors.cobalt.600}", "{colors.cobalt.500}"),
          accentSubtle: pair("{colors.cobalt.50}", "{colors.cobalt.900}"),
          link: pair("{colors.cobalt.700}", "{colors.cobalt.300}"),
          focusRing: pair("{colors.cobalt.600}", "{colors.cobalt.500}"),
          focusHalo: pair("rgba(46, 82, 214, 0.28)", "rgba(124, 155, 255, 0.4)"),
          // Status: foreground, background, border per tone.
          danger: pair("#C0352B", "#FF8A80"),
          dangerHover: pair("#A12B22", "#FFA59D"),
          onDanger: pair("{colors.neutral.0}", "{colors.neutral.950}"),
          status: {
            neutral: {
              fg: pair("{colors.neutral.600}", "#B4B4BB"),
              bg: pair("{colors.neutral.100}", "{colors.neutral.850}"),
              border: pair("{colors.neutral.200}", "{colors.neutral.750}"),
            },
            success: {
              fg: pair("#127A52", "#5FD3A0"),
              bg: pair("#E8F6EF", "#10291F"),
              border: pair("#B4E2CB", "#1F4A37"),
            },
            warning: {
              fg: pair("#9A5B00", "#F2C46B"),
              bg: pair("#FFF5E5", "#2E2410"),
              border: pair("#F5D49A", "#5A4519"),
            },
            danger: {
              fg: pair("#C0352B", "#FF8A80"),
              bg: pair("#FDECEA", "#331715"),
              border: pair("#F5C2BD", "#5C2621"),
            },
            info: {
              fg: pair("#1F64B8", "#7DB5FF"),
              bg: pair("#EAF2FD", "#12233A"),
              border: pair("#BBD4F5", "#23426B"),
            },
          },
          icon: {
            muted: pair("{colors.neutral.550}", "{colors.neutral.400}"),
            subtle: pair("{colors.neutral.500}", "#7C7C85"),
            success: pair("#127A52", "#5FD3A0"),
            warning: pair("#9A5B00", "#F2C46B"),
            danger: pair("#C0352B", "#FF8A80"),
            info: pair("#1F64B8", "#7DB5FF"),
            disabled: pair("{colors.neutral.400}", "{colors.neutral.600}"),
            inverse: pair("{colors.neutral.0}", "{colors.neutral.950}"),
          },
        },
        // Four steps of depth. In the dark theme a hairline of light does the separating.
        shadows: {
          control: {
            value: {
              base: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
              _dark: "0 1px 2px 0 rgba(0, 0, 0, 0.4)",
            },
          },
          raised: {
            value: {
              base: "0 1px 3px 0 rgba(0, 0, 0, 0.06), 0 1px 2px -1px rgba(0, 0, 0, 0.06)",
              _dark: "0 1px 2px 0 rgba(0, 0, 0, 0.5)",
            },
          },
          floating: {
            value: {
              base: "0 8px 20px -6px rgba(0, 0, 0, 0.12), 0 2px 6px -2px rgba(0, 0, 0, 0.06)",
              _dark: "0 8px 24px -6px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06)",
            },
          },
          overlay: {
            value: {
              base: "0 24px 48px -12px rgba(0, 0, 0, 0.22), 0 6px 16px -6px rgba(0, 0, 0, 0.1)",
              _dark: "0 24px 48px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.06)",
            },
          },
        },
      },
      keyframes: {
        "enter-subtle": {
          from: { opacity: 0, transform: "translateY(4px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        "pop-in": {
          from: { opacity: 0, transform: "scale(0.96)" },
          to: { opacity: 1, transform: "scale(1)" },
        },
        spin: { to: { transform: "rotate(360deg)" } },
      },
      animationStyles: motionAnimationStyles,
      // The family and normal tracking are inherited from `body` (form controls inherit them
      // through the reset), so a style names them only when it differs.
      textStyles: {
        body: {
          value: {
            fontFamily: "body",
            letterSpacing: "normal",
            fontSize: "md",
            fontWeight: "regular",
            lineHeight: "md",
          },
        },
        label: {
          value: {
            fontSize: "md",
            fontWeight: "medium",
            lineHeight: "md",
          },
        },
        helper: {
          value: {
            fontSize: "sm",
            fontWeight: "regular",
            lineHeight: "sm",
          },
        },
        metadata: {
          value: {
            fontSize: "xs",
            fontWeight: "medium",
            lineHeight: "xs",
          },
        },
        tableHeader: {
          value: {
            fontSize: "sm",
            fontWeight: "medium",
            lineHeight: "md",
          },
        },
        tableCell: {
          value: {
            fontSize: "md",
            fontWeight: "regular",
            lineHeight: "md",
          },
        },
        pageTitle: {
          value: {
            fontSize: "3xl",
            fontWeight: "semibold",
            lineHeight: "3xl",
            letterSpacing: "display",
          },
        },
        sectionTitle: {
          value: {
            fontSize: "lg",
            fontWeight: "semibold",
            lineHeight: "lg",
            letterSpacing: "heading",
          },
        },
        display: {
          value: {
            fontSize: "4xl",
            fontWeight: "semibold",
            lineHeight: "4xl",
            letterSpacing: "display",
            fontVariantNumeric: "tabular-nums",
          },
        },
        button: {
          value: {
            fontSize: "md",
            fontWeight: "medium",
            lineHeight: "md",
          },
        },
        status: {
          value: {
            fontSize: "xs",
            fontWeight: "medium",
            lineHeight: "xs",
          },
        },
        numeric: {
          value: {
            fontSize: "md",
            fontWeight: "medium",
            lineHeight: "md",
            fontVariantNumeric: "tabular-nums",
          },
        },
        code: {
          value: {
            fontFamily: "mono",
            fontSize: "xs",
            fontWeight: "regular",
            lineHeight: "xs",
          },
        },
      },
      recipes: {
        control: {
          className: "control",
          base: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "2",
            textStyle: "body",
            borderRadius: "control",
            borderWidth: "1px",
            borderColor: "boundaryControl",
            minHeight: "9",
            px: "3",
            color: "text",
            // Color only, never the `background` shorthand: a select keeps its arrow image.
            bgColor: "content",
            whiteSpace: "nowrap",
            boxShadow: "control",
            // Named properties only: `all` would animate whatever else changes.
            transitionProperty: "[background-color, border-color, color, box-shadow, transform]",
            transitionDuration: "press",
            transitionTimingFunction: "out",
            _motionReduce: { transitionDuration: "none" },
            _hover: { bgColor: "contentHover" },
            // A button answers a press at once. Fields do not move.
            _motionSafe: { "&:is(button):active:not(:disabled)": { transform: "scale(0.97)" } },
            // A soft halo outside a solid edge: the edge carries the 3:1 focus contrast.
            _focusVisible: {
              outline: "[3px solid]",
              outlineColor: "focusHalo",
              outlineOffset: "[0px]",
              borderColor: "focusRing",
            },
            _disabled: { cursor: "not-allowed", opacity: "0.5", _hover: { bgColor: "content" } },
            "@media (forced-colors: active)": {
              color: "ButtonText",
              background: "ButtonFace",
              borderColor: "ButtonText",
            },
          },
          variants: {
            kind: {
              secondary: { textStyle: "button", px: "4", cursor: "pointer" },
              action: {
                textStyle: "button",
                px: "4",
                bgColor: "action",
                color: "onAction",
                borderColor: "action",
                cursor: "pointer",
                _hover: { bgColor: "actionHover", borderColor: "actionHover" },
                _disabled: { _hover: { bgColor: "action", borderColor: "action" } },
                "@media (forced-colors: active)": {
                  color: "ButtonText",
                  background: "ButtonFace",
                  borderColor: "ButtonText",
                },
              },
              ghost: {
                textStyle: "button",
                bgColor: "transparent",
                borderColor: "transparent",
                boxShadow: "none",
                color: "muted",
                cursor: "pointer",
                _hover: { bgColor: "contentHover", color: "text" },
                _disabled: { _hover: { bgColor: "transparent" } },
              },
              danger: {
                textStyle: "button",
                px: "4",
                bgColor: "danger",
                color: "onDanger",
                borderColor: "danger",
                cursor: "pointer",
                _hover: { bgColor: "dangerHover", borderColor: "dangerHover" },
              },
              input: {
                justifyContent: "flex-start",
                width: "full",
                maxWidth: "xl",
                borderColor: "boundaryStrong",
                textAlign: "start",
                _hover: { bgColor: "content", borderColor: "muted" },
                _placeholder: { color: "muted" },
                "&[aria-invalid=true]": { borderColor: "danger" },
                // The platform arrow differs per browser and crowds the edge, so a select draws
                // its own.
                "&:is(select)": {
                  appearance: "none",
                  pr: "9",
                  bgImage:
                    "[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%2371717A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")]",
                  bgRepeat: "no-repeat",
                  bgPosition: "[right 0.625rem center]",
                  bgSize: "[1rem]",
                  cursor: "pointer",
                },
              },
            },
            size: {
              md: {},
              sm: { minHeight: "8", px: "3" },
            },
          },
          defaultVariants: { size: "md" },
        },
        surface: {
          className: "surface",
          base: {
            // A table that bleeds to the edges reads this, so it follows the padding at every width.
            "--surface-pad": { base: "{spacing.4}", md: "{spacing.6}" },
            minWidth: "0",
            bg: "content",
            borderWidth: "1px",
            borderColor: "boundary",
            borderRadius: "surface",
            boxShadow: "raised",
            p: "[var(--surface-pad)]",
          },
          variants: {
            tone: {
              default: {},
              subtle: { "--surface-pad": "{spacing.4}", bg: "contentSubtle", boxShadow: "none" },
              flush: {
                p: "0",
                overflow: "hidden",
                "& th:first-child, & td:first-child": { pl: "[var(--surface-pad)]" },
                "& th:last-child, & td:last-child": { pr: "[var(--surface-pad)]" },
              },
            },
          },
          defaultVariants: { tone: "default" },
        },
      },
    },
  },
  staticCss: { recipes: { control: ["*"], surface: ["*"] } },
  globalCss: {
    // Text styles live on body, not html, so 1rem stays 16px and the spacing/size tokens keep the
    // documented 4px grid (36px controls).
    html: {
      bg: "canvas",
      color: "text",
      WebkitFontSmoothing: "antialiased",
      MozOsxFontSmoothing: "grayscale",
      textRendering: "optimizeLegibility",
      WebkitTapHighlightColor: "transparent",
    },
    body: { margin: "0", textStyle: "body" },
    // Printing shows only the document marked for it, so "Print" can also save a PDF.
    "[data-print-sheet]": { display: "none" },
    "@media print": {
      "body *": { visibility: "hidden" },
      // Black on white whatever the theme, since a printed page has no dark mode.
      "[data-print-sheet], [data-print-sheet] *": { visibility: "visible", color: "[black]" },
      "[data-print-sheet]": {
        display: "block",
        position: "absolute",
        insetInlineStart: "0",
        insetBlockStart: "0",
        width: "[100%]",
      },
    },
    "[data-theme=dark]": { colorScheme: "dark" },
    "[data-theme=light]": { colorScheme: "light" },
    "::selection": { bg: "accentSubtle", color: "text" },
    h1: { textStyle: "pageTitle" },
    h2: { textStyle: "sectionTitle" },
    h3: { textStyle: "label", fontWeight: "semibold" },
    p: { maxWidth: "[65ch]" },
    a: {
      color: "link",
      textDecoration: "underline",
      textDecorationColor: "[color-mix(in srgb, currentColor 40%, transparent)]",
      textUnderlineOffset: "3px",
      _hover: { textDecorationColor: "[currentColor]" },
    },
    "a:focus-visible, summary:focus-visible": {
      outline: "[2px solid]",
      outlineColor: "focusRing",
      outlineOffset: "[2px]",
      borderRadius: "xs",
    },
    "input, select, textarea": { colorScheme: "inherit" },
    fieldset: { minWidth: "0" },
    legend: { textStyle: "sectionTitle", mb: "2" },
    table: {
      width: "full",
      borderCollapse: "separate",
      borderSpacing: "0",
      fontVariantNumeric: "tabular-nums",
    },
    "th, td": {
      textAlign: "left",
      px: "3",
      py: "2.5",
      borderBottomWidth: "1px",
      borderColor: "boundary",
      verticalAlign: "middle",
      overflowWrap: "anywhere",
    },
    "thead th": {
      textStyle: "tableHeader",
      color: "muted",
      whiteSpace: "nowrap",
    },
    "tbody th": { textStyle: "tableCell", fontWeight: "medium" },
    td: { textStyle: "tableCell" },
    // Rows are scanned all day, so the hover tint is immediate: a trailing fade would only lag.
    "@media (hover: hover) and (pointer: fine)": {
      "tbody tr:hover": { bg: "contentSubtle" },
    },
    "tbody tr:last-child > *": { borderBottomWidth: "0" },
    caption: { textAlign: "left", color: "muted", pb: "3", textStyle: "helper" },
    "[role=alert]": { color: "danger" },
    "p[role=status]": { color: "muted" },
    "h2 + p": { color: "muted", mt: "-2.5" },
    code: { fontFamily: "mono", fontSize: "[0.92em]" },
    "td code, tbody th code": {
      display: "inline-block",
      maxWidth: "[19ch]",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      verticalAlign: "bottom",
    },
    ".sr-only": {
      position: "absolute",
      width: "[1px]",
      height: "[1px]",
      p: "0",
      m: "[-1px]",
      overflow: "hidden",
      clip: "rect(0, 0, 0, 0)",
      whiteSpace: "nowrap",
      borderWidth: "0",
    },
    "@media (forced-colors: active)": {
      "button, input": { border: "1px solid ButtonText" },
    },
  },
})
