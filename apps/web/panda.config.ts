import { defineAnimationStyles, defineConfig, definePreset } from "@pandacss/dev"
import pandaPreset from "@pandacss/preset-panda"

// The stock preset minus categories RITSEI does not use (its ~240-variable color palette, blurs,
// aspect ratios, stock shadows, and stock animations). RITSEI emits only its own colors, shadows,
// and keyframes, which keeps the shipped stylesheet inside the 50 KB budget (ADR-0090).
const {
  blurs: _blurs,
  aspectRatios: _aspectRatios,
  animations: _animations,
  shadows: _shadows,
  ...presetTokens
} = pandaPreset.theme?.tokens ?? {}

const ritseiBasePreset = definePreset({
  ...pandaPreset,
  name: "ritsei-base",
  theme: {
    ...pandaPreset.theme,
    keyframes: {},
    tokens: {
      ...presetTokens,
      colors: {
        transparent: { value: "transparent" },
        current: { value: "currentColor" },
      },
    },
  },
})

const motionAnimationStyles = defineAnimationStyles({
  "enter-subtle": {
    value: {
      animationName: "enter-subtle",
      animationDuration: "normal",
      animationTimingFunction: "enter",
      animationFillMode: "both",
      _motionReduce: {
        animationName: "fade-in",
        animationDuration: "instant",
        animationTimingFunction: "linear",
      },
    },
  },
  "exit-subtle": {
    value: {
      animationName: "exit-subtle",
      animationDuration: "fast",
      animationTimingFunction: "exit",
      animationFillMode: "both",
      _motionReduce: {
        animationName: "fade-out",
        animationDuration: "instant",
        animationTimingFunction: "linear",
      },
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
  conditions: { dark: "[data-theme=dark] &" },
  theme: {
    extend: {
      tokens: {
        colors: {
          // Primitive palettes. Feature code never consumes these directly.
          steel: {
            0: { value: "#FFFFFF" },
            25: { value: "#FAFBFC" },
            50: { value: "#F5F6F8" },
            75: { value: "#F0F2F5" },
            100: { value: "#E9ECF0" },
            150: { value: "#E3E6EB" },
            200: { value: "#D3D8DF" },
            400: { value: "#8A93A0" },
            500: { value: "#6B7380" },
            600: { value: "#5B6370" },
            800: { value: "#2B3039" },
            900: { value: "#161A20" },
          },
          graphite: {
            500: { value: "#5F6672" },
            600: { value: "#3A3F48" },
            700: { value: "#2C3139" },
            750: { value: "#262A31" },
            800: { value: "#1D2127" },
            850: { value: "#1A1D23" },
            900: { value: "#15181D" },
            925: { value: "#121418" },
            950: { value: "#0E1014" },
          },
          cobalt: {
            50: { value: "#EEF2FF" },
            100: { value: "#DCE4FE" },
            300: { value: "#A9BCFF" },
            400: { value: "#98B0FF" },
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
          pageHeading: { value: "-0.012em" },
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
          sidebarCollapsed: { value: "3.5rem" },
          topbar: { value: "3rem" },
          inspector: { value: "24rem" },
          content: { value: "90rem" },
        },
        radii: {
          control: { value: "6px" },
          surface: { value: "8px" },
          overlay: { value: "10px" },
        },
        zIndex: {
          base: { value: "0" },
          sticky: { value: "100" },
          modal: { value: "1100" },
          skipLink: { value: "1200" },
        },
        durations: {
          none: { value: "0ms" },
          instant: { value: "80ms" },
          fast: { value: "120ms" },
          normal: { value: "180ms" },
          deliberate: { value: "240ms" },
          slow: { value: "320ms" },
        },
        easings: {
          standard: { value: "cubic-bezier(0.2, 0, 0, 1)" },
          enter: { value: "cubic-bezier(0.16, 1, 0.3, 1)" },
          exit: { value: "cubic-bezier(0.4, 0, 1, 1)" },
          emphasized: { value: "cubic-bezier(0.16, 1, 0.3, 1)" },
        },
      },
      semanticTokens: {
        colors: {
          // Surfaces
          backdrop: pair("rgba(14, 16, 20, 0.45)", "rgba(0, 0, 0, 0.66)"),
          canvas: pair("{colors.steel.50}", "{colors.graphite.950}"),
          content: pair("{colors.steel.0}", "{colors.graphite.900}"),
          contentSubtle: pair("{colors.steel.25}", "{colors.graphite.850}"),
          contentHover: pair("{colors.steel.75}", "{colors.graphite.800}"),
          contentSelected: pair("{colors.cobalt.50}", "{colors.cobalt.900}"),
          navigation: pair("{colors.steel.25}", "{colors.graphite.925}"),
          // Text
          text: pair("{colors.steel.900}", "#E6E8EB"),
          muted: pair("{colors.steel.600}", "#9AA1AC"),
          // Borders
          boundary: pair("{colors.steel.150}", "{colors.graphite.750}"),
          boundaryControl: pair("{colors.steel.200}", "{colors.graphite.600}"),
          boundaryStrong: pair("{colors.steel.400}", "{colors.graphite.500}"),
          // Action
          action: pair("{colors.cobalt.600}", "{colors.cobalt.500}"),
          actionHover: pair("{colors.cobalt.700}", "{colors.cobalt.400}"),
          actionText: pair("{colors.cobalt.700}", "{colors.cobalt.300}"),
          actionSubtle: pair("{colors.cobalt.50}", "{colors.cobalt.900}"),
          onAction: pair("{colors.steel.0}", "{colors.graphite.950}"),
          focusRing: pair("{colors.cobalt.600}", "{colors.cobalt.500}"),
          // Status: foreground, background, border per tone.
          danger: pair("#C0352B", "#FF8A80"),
          dangerHover: pair("#A12B22", "#FFA59D"),
          onDanger: pair("{colors.steel.0}", "{colors.graphite.950}"),
          status: {
            neutral: {
              fg: pair("{colors.steel.600}", "#B3B9C2"),
              bg: pair("#F1F3F5", "#1F232A"),
              border: pair("#DDE1E6", "#30353D"),
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
            default: pair("{colors.steel.900}", "#E6E8EB"),
            muted: pair("{colors.steel.600}", "#9AA1AC"),
            subtle: pair("{colors.steel.500}", "#7C8390"),
            success: pair("#127A52", "#5FD3A0"),
            warning: pair("#9A5B00", "#F2C46B"),
            danger: pair("#C0352B", "#FF8A80"),
            info: pair("#1F64B8", "#7DB5FF"),
            disabled: pair("#A3AAB4", "#4F5560"),
            inverse: pair("{colors.steel.0}", "{colors.graphite.950}"),
          },
        },
        shadows: {
          raised: {
            value: {
              base: "0 1px 2px rgba(16, 24, 40, 0.05)",
              _dark: "0 1px 2px rgba(0, 0, 0, 0.4)",
            },
          },
          overlay: {
            value: {
              base: "0 16px 40px -8px rgba(16, 24, 40, 0.18), 0 4px 12px -4px rgba(16, 24, 40, 0.08)",
              _dark: "0 16px 40px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06)",
            },
          },
        },
      },
      keyframes: {
        "enter-subtle": {
          from: { opacity: 0, transform: "translateY(4px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        "exit-subtle": {
          from: { opacity: 1, transform: "translateY(0)" },
          to: { opacity: 0, transform: "translateY(2px)" },
        },
        "fade-in": {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        "fade-out": {
          from: { opacity: 1 },
          to: { opacity: 0 },
        },
      },
      animationStyles: motionAnimationStyles,
      textStyles: {
        body: {
          value: {
            fontFamily: "body",
            fontSize: "md",
            fontWeight: "regular",
            lineHeight: "md",
            letterSpacing: "normal",
          },
        },
        bodyCompact: {
          value: {
            fontFamily: "body",
            fontSize: "sm",
            fontWeight: "regular",
            lineHeight: "sm",
            letterSpacing: "normal",
          },
        },
        label: {
          value: {
            fontFamily: "body",
            fontSize: "sm",
            fontWeight: "medium",
            lineHeight: "sm",
            letterSpacing: "normal",
          },
        },
        helper: {
          value: {
            fontFamily: "body",
            fontSize: "xs",
            fontWeight: "regular",
            lineHeight: "xs",
            letterSpacing: "normal",
          },
        },
        metadata: {
          value: {
            fontFamily: "body",
            fontSize: "xs",
            fontWeight: "medium",
            lineHeight: "xs",
            letterSpacing: "normal",
          },
        },
        tableHeader: {
          value: {
            fontFamily: "body",
            fontSize: "xs",
            fontWeight: "medium",
            lineHeight: "xs",
            letterSpacing: "normal",
          },
        },
        tableCell: {
          value: {
            fontFamily: "body",
            fontSize: "sm",
            fontWeight: "regular",
            lineHeight: "md",
            letterSpacing: "normal",
          },
        },
        pageTitle: {
          value: {
            fontFamily: "body",
            fontSize: "2xl",
            fontWeight: "semibold",
            lineHeight: "2xl",
            letterSpacing: "pageHeading",
          },
        },
        sectionTitle: {
          value: {
            fontFamily: "body",
            fontSize: "md",
            fontWeight: "semibold",
            lineHeight: "md",
            letterSpacing: "heading",
          },
        },
        display: {
          value: {
            fontFamily: "body",
            fontSize: "3xl",
            fontWeight: "semibold",
            lineHeight: "3xl",
            letterSpacing: "display",
            fontVariantNumeric: "tabular-nums",
          },
        },
        button: {
          value: {
            fontFamily: "body",
            fontSize: "sm",
            fontWeight: "medium",
            lineHeight: "sm",
            letterSpacing: "normal",
          },
        },
        status: {
          value: {
            fontFamily: "body",
            fontSize: "xs",
            fontWeight: "medium",
            lineHeight: "xs",
            letterSpacing: "normal",
          },
        },
        numeric: {
          value: {
            fontFamily: "body",
            fontSize: "md",
            fontWeight: "medium",
            lineHeight: "md",
            letterSpacing: "normal",
            fontVariantNumeric: "tabular-nums",
          },
        },
        code: {
          value: {
            fontFamily: "mono",
            fontSize: "xs",
            fontWeight: "regular",
            lineHeight: "xs",
            letterSpacing: "normal",
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
            bg: "content",
            whiteSpace: "nowrap",
            boxShadow: "raised",
            transitionProperty: "[background-color, border-color, color, box-shadow]",
            transitionDuration: "fast",
            transitionTimingFunction: "standard",
            _motionReduce: { transitionDuration: "none" },
            _hover: { bg: "contentHover" },
            _focusVisible: {
              outline: "[2px solid]",
              outlineColor: "focusRing",
              outlineOffset: "[2px]",
            },
            _disabled: { cursor: "not-allowed", opacity: "0.55", _hover: { bg: "content" } },
            "@media (forced-colors: active)": {
              color: "ButtonText",
              background: "ButtonFace",
              borderColor: "ButtonText",
            },
          },
          variants: {
            kind: {
              secondary: { textStyle: "button", cursor: "pointer" },
              action: {
                textStyle: "button",
                bg: "action",
                color: "onAction",
                borderColor: "action",
                cursor: "pointer",
                _hover: { bg: "actionHover", borderColor: "actionHover" },
                _disabled: { _hover: { bg: "action", borderColor: "action" } },
                "@media (forced-colors: active)": {
                  color: "ButtonText",
                  background: "ButtonFace",
                  borderColor: "ButtonText",
                },
              },
              ghost: {
                textStyle: "button",
                bg: "transparent",
                borderColor: "transparent",
                boxShadow: "none",
                color: "muted",
                cursor: "pointer",
                _hover: { bg: "contentHover", color: "text" },
                _disabled: { _hover: { bg: "transparent" } },
              },
              danger: {
                textStyle: "button",
                bg: "danger",
                color: "onDanger",
                borderColor: "danger",
                cursor: "pointer",
                _hover: { bg: "dangerHover", borderColor: "dangerHover" },
              },
              input: {
                justifyContent: "flex-start",
                width: "full",
                maxWidth: "xl",
                borderColor: "boundaryStrong",
                boxShadow: "none",
                textAlign: "start",
                _hover: { bg: "content", borderColor: "muted" },
                _placeholder: { color: "muted" },
              },
            },
            size: {
              md: {},
              sm: { minHeight: "8", px: "2.5" },
            },
          },
          defaultVariants: { size: "md" },
        },
        surface: {
          className: "surface",
          base: {
            minWidth: "0",
            bg: "content",
            borderWidth: "1px",
            borderColor: "boundary",
            borderRadius: "surface",
            boxShadow: "raised",
            p: "4",
          },
          variants: {
            tone: {
              default: {},
              subtle: { bg: "contentSubtle", boxShadow: "none" },
              flush: {
                p: "0",
                overflow: "hidden",
                "& th:first-child, & td:first-child": { pl: "4" },
                "& th:last-child, & td:last-child": { pr: "4" },
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
    html: {
      bg: "canvas",
      color: "text",
      textStyle: "body",
      WebkitFontSmoothing: "antialiased",
      MozOsxFontSmoothing: "grayscale",
      textRendering: "optimizeLegibility",
    },
    body: { margin: "0" },
    "[data-theme=dark]": { colorScheme: "dark" },
    "[data-theme=light]": { colorScheme: "light" },
    "::selection": { bg: "actionSubtle", color: "text" },
    h1: { textStyle: "pageTitle" },
    h2: { textStyle: "sectionTitle" },
    h3: { textStyle: "label", fontWeight: "semibold" },
    p: { maxWidth: "[72ch]" },
    a: {
      color: "actionText",
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
      bg: "contentSubtle",
      py: "2",
      whiteSpace: "nowrap",
    },
    "tbody th": { textStyle: "tableCell", fontWeight: "medium" },
    td: { textStyle: "tableCell" },
    "tbody tr": {
      transitionProperty: "[background-color]",
      transitionDuration: "instant",
    },
    "tbody tr:hover": { bg: "contentHover" },
    "tbody tr:last-child > *": { borderBottomWidth: "0" },
    caption: { textAlign: "left", color: "muted", pb: "3", textStyle: "helper" },
    "[role=alert]": { color: "danger" },
    "p[role=status]": { color: "muted" },
    "h2 + p": { color: "muted", textStyle: "bodyCompact", mt: "-2" },
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
