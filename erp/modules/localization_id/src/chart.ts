import type { ChartTemplate } from "../../accounting/mod.ts"

/** The id the Indonesian trading chart is applied by. */
export const indonesiaTradingTemplateId = "indonesia_trading"

/**
 * A chart of accounts for an Indonesian trading company, in the usual five groups: assets
 * (aset), liabilities (kewajiban), equity (ekuitas), revenue (pendapatan), and expenses (beban).
 * Account names are the Indonesian terms; posting roles map to the same business accounts as the
 * neutral chart, so every posting rule resolves.
 */
export const indonesiaTrading: ChartTemplate = {
  accounts: [
    { code: "1-0000", name: "Aset", type: "asset" },
    { code: "1-1100", name: "Kas dan bank", type: "asset", parentCode: "1-0000" },
    { code: "1-1200", name: "Piutang usaha", type: "asset", parentCode: "1-0000" },
    { code: "1-1300", name: "Persediaan barang dagang", type: "asset", parentCode: "1-0000" },
    { code: "1-1400", name: "PPN masukan", type: "asset", parentCode: "1-0000" },
    { code: "2-0000", name: "Kewajiban", type: "liability" },
    { code: "2-1100", name: "Utang usaha", type: "liability", parentCode: "2-0000" },
    { code: "2-1200", name: "PPN keluaran", type: "liability", parentCode: "2-0000" },
    {
      code: "2-1300",
      name: "Barang diterima belum ditagih",
      type: "liability",
      parentCode: "2-0000",
    },
    { code: "3-0000", name: "Ekuitas", type: "equity" },
    { code: "3-1100", name: "Modal pemilik", type: "equity", parentCode: "3-0000" },
    { code: "3-1200", name: "Laba ditahan", type: "equity", parentCode: "3-0000" },
    { code: "4-0000", name: "Pendapatan", type: "revenue" },
    { code: "4-1100", name: "Penjualan", type: "revenue", parentCode: "4-0000" },
    { code: "5-0000", name: "Beban", type: "expense" },
    { code: "5-1100", name: "Harga pokok penjualan", type: "expense", parentCode: "5-0000" },
    { code: "5-1200", name: "Selisih harga pembelian", type: "expense", parentCode: "5-0000" },
    { code: "5-1300", name: "Penyesuaian persediaan", type: "expense", parentCode: "5-0000" },
  ],
  postingRules: {
    cash: "1-1100",
    receivable: "1-1200",
    inventory: "1-1300",
    input_tax: "1-1400",
    payable: "2-1100",
    output_tax: "2-1200",
    goods_received_not_invoiced: "2-1300",
    revenue: "4-1100",
    cost_of_goods_sold: "5-1100",
    purchase_price_variance: "5-1200",
    inventory_adjustment: "5-1300",
  },
}
