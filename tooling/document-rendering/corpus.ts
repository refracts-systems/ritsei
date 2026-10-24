import {
  DocumentBarcodeNode,
  type DocumentCapability,
  DocumentImageNode,
  type DocumentNode,
  DocumentPageBreakNode,
  DocumentQrCodeNode,
  DocumentSignatureNode,
  DocumentTableNode,
  DocumentTextNode,
} from "../../framework/foundation/mod.ts"

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
      DocumentTextNode.make({ value: "PURCHASE ORDER" }),
      DocumentTableNode.make({ headers: ["Item", "Quantity", "Unit Price"], rows: tableRows(3) }),
      DocumentTextNode.make({ value: "Total 25.00" }),
    ],
    capabilities: [],
    pageCount: 1,
    assetBytes: 0,
  },
  {
    name: "purchase-order-large",
    nodes: [
      DocumentTextNode.make({ value: "PURCHASE ORDER" }),
      DocumentTableNode.make({ headers: ["Item", "Quantity", "Unit Price"], rows: tableRows(100) }),
      DocumentTextNode.make({ value: "Total 2500.00" }),
    ],
    capabilities: [],
    pageCount: 5,
    assetBytes: 0,
  },
  {
    name: "unicode-cjk-rtl",
    nodes: [
      DocumentTextNode.make({ value: "فاتورة شراء / 仕入注文 / 구매 주문" }),
      DocumentTextNode.make({ value: "Noto Sans CJK + RTL fixture" }),
    ],
    capabilities: ["svg"],
    pageCount: 1,
    assetBytes: 0,
  },
  {
    name: "pagination-table",
    nodes: [
      DocumentTextNode.make({ value: "MULTI-PAGE STATEMENT" }),
      DocumentTableNode.make({
        headers: ["Reference", "Quantity", "Amount"],
        rows: tableRows(250),
      }),
      DocumentPageBreakNode.make({}),
      DocumentTextNode.make({ value: "REPEATED PAGE SECTION" }),
    ],
    capabilities: ["paged-media"],
    pageCount: 12,
    assetBytes: 0,
  },
  {
    name: "asset-and-code-heavy",
    nodes: [
      DocumentImageNode.make({ assetId: "logo-v1", alt: "Company logo" }),
      DocumentBarcodeNode.make({ value: "PO-2026-0001" }),
      DocumentQrCodeNode.make({ value: "https://example.invalid/document/PO-2026-0001" }),
      DocumentSignatureNode.make({ assetId: "signature-v1", label: "Approved by" }),
    ],
    capabilities: ["svg"],
    pageCount: 1,
    assetBytes: 128_000,
  },
]
