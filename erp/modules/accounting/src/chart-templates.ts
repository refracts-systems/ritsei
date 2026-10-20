import type { AccountType, PostingRole } from "./general-ledger-contract.ts"

export type TemplateAccount = {
  readonly code: string
  readonly name: string
  readonly type: AccountType
  readonly parentCode?: string
}

export type ChartTemplate = {
  readonly accounts: ReadonlyArray<TemplateAccount>
  readonly postingRules: Readonly<Record<PostingRole, string>>
}

/**
 * A jurisdiction-neutral chart for a trading company. Localization modules supply their own
 * templates (for example an Indonesian chart) through the same mechanism.
 */
const neutralTrading: ChartTemplate = {
  accounts: [
    { code: "1000", name: "Assets", type: "asset" },
    { code: "1100", name: "Cash and bank", type: "asset", parentCode: "1000" },
    { code: "1200", name: "Accounts receivable", type: "asset", parentCode: "1000" },
    { code: "1300", name: "Inventory", type: "asset", parentCode: "1000" },
    { code: "1400", name: "Input tax receivable", type: "asset", parentCode: "1000" },
    { code: "2000", name: "Liabilities", type: "liability" },
    { code: "2100", name: "Accounts payable", type: "liability", parentCode: "2000" },
    { code: "2200", name: "Output tax payable", type: "liability", parentCode: "2000" },
    { code: "2300", name: "Goods received not invoiced", type: "liability", parentCode: "2000" },
    { code: "3000", name: "Equity", type: "equity" },
    { code: "3100", name: "Owner's equity", type: "equity", parentCode: "3000" },
    { code: "3200", name: "Retained earnings", type: "equity", parentCode: "3000" },
    { code: "4000", name: "Revenue", type: "revenue" },
    { code: "4100", name: "Sales revenue", type: "revenue", parentCode: "4000" },
    { code: "5000", name: "Expenses", type: "expense" },
    { code: "5100", name: "Cost of goods sold", type: "expense", parentCode: "5000" },
    { code: "5200", name: "Purchase price variance", type: "expense", parentCode: "5000" },
    { code: "5300", name: "Inventory adjustments", type: "expense", parentCode: "5000" },
  ],
  postingRules: {
    cash: "1100",
    receivable: "1200",
    inventory: "1300",
    input_tax: "1400",
    payable: "2100",
    output_tax: "2200",
    goods_received_not_invoiced: "2300",
    revenue: "4100",
    cost_of_goods_sold: "5100",
    purchase_price_variance: "5200",
    inventory_adjustment: "5300",
  },
}

export const chartTemplates = { neutral_trading: neutralTrading } as const
