import { defineModule } from "../../../framework/modules/module/mod.ts"
import { AccountingCapabilities } from "./src/capabilities.ts"
import { AccountingTypedActionCatalog, AccountingTypedEventCatalog } from "./src/catalog.ts"

export const AccountingModule = defineModule({
  name: "accounting",
  layer: "erp",
  dependsOn: ["sales"],
  schemas: ["accounting"],
  capabilities: AccountingCapabilities,
  actions: AccountingTypedActionCatalog,
  events: AccountingTypedEventCatalog,
  consumes: [],
  http: ["Accounting"],
  pages: ["/accounting"],
})
