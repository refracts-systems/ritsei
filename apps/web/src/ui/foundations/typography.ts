import { css } from "../generated/css/index.js"

// Approved semantic text styles. Components should not choose raw type tokens.
export const typography = {
  body: css({ textStyle: "body" }),
  label: css({ textStyle: "label" }),
  helper: css({ textStyle: "helper" }),
  metadata: css({ textStyle: "metadata" }),
  tableHeader: css({ textStyle: "tableHeader" }),
  tableCell: css({ textStyle: "tableCell" }),
  pageTitle: css({ textStyle: "pageTitle" }),
  sectionTitle: css({ textStyle: "sectionTitle" }),
  display: css({ textStyle: "display" }),
  button: css({ textStyle: "button" }),
  status: css({ textStyle: "status" }),
  numeric: css({ textStyle: "numeric" }),
  code: css({ textStyle: "code" }),
} as const
