import type { DocumentCapability, DocumentNode } from "../../framework/foundation/mod.ts"

export type DocumentBenchmarkFixture = {
  readonly name: string
  readonly nodes: ReadonlyArray<DocumentNode>
  readonly capabilities: ReadonlyArray<DocumentCapability>
  readonly pageCount: number
  readonly assetBytes: number
}

const tableRows = (count: number) =>
  Array.from({ length: count }, (_, index) => [
    `ITEM-${String(index + 1).padStart(4, "0")}`,
    String((index % 9) + 1),
    `${((index % 17) + 1) * 2}.00`,
  ])

export const documentBenchmarkCorpus: ReadonlyArray<DocumentBenchmarkFixture> = [
  {
    name: "purchase-order-small",
    nodes: [
      { _tag: "text", value: "PURCHASE ORDER" },
      { _tag: "table", headers: ["Item", "Quantity", "Unit Price"], rows: tableRows(3) },
      { _tag: "text", value: "Total 25.00" },
    ],
    capabilities: [],
    pageCount: 1,
    assetBytes: 0,
  },
  {
    name: "purchase-order-large",
    nodes: [
      { _tag: "text", value: "PURCHASE ORDER" },
      { _tag: "table", headers: ["Item", "Quantity", "Unit Price"], rows: tableRows(100) },
      { _tag: "text", value: "Total 2500.00" },
    ],
    capabilities: [],
    pageCount: 5,
    assetBytes: 0,
  },
  {
    name: "unicode-cjk-rtl",
    nodes: [
      { _tag: "text", value: "فاتورة شراء / 仕入注文 / 구매 주문" },
      { _tag: "text", value: "Noto Sans CJK + RTL fixture" },
    ],
    capabilities: ["svg"],
    pageCount: 1,
    assetBytes: 0,
  },
  {
    name: "pagination-table",
    nodes: [
      { _tag: "text", value: "MULTI-PAGE STATEMENT" },
      { _tag: "table", headers: ["Reference", "Quantity", "Amount"], rows: tableRows(250) },
      { _tag: "page_break" },
      { _tag: "text", value: "REPEATED PAGE SECTION" },
    ],
    capabilities: ["paged-media"],
    pageCount: 12,
    assetBytes: 0,
  },
  {
    name: "asset-and-code-heavy",
    nodes: [
      { _tag: "image", assetId: "logo-v1", alt: "Company logo" },
      { _tag: "barcode", value: "PO-2026-0001" },
      { _tag: "qr_code", value: "https://example.invalid/document/PO-2026-0001" },
      { _tag: "signature", assetId: "signature-v1", label: "Approved by" },
    ],
    capabilities: ["svg"],
    pageCount: 1,
    assetBytes: 128_000,
  },
]
