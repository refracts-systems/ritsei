import { defineModule } from "../../../framework/modules/module/mod.ts"
import { SalesCapabilities } from "./src/capabilities.ts"
import { SalesTypedActionCatalog, SalesTypedEventCatalog } from "./src/catalog.ts"

export const SalesModule = defineModule({
  name: "sales",
  layer: "erp",
  dependsOn: ["party", "tax"],
  schemas: ["sales"],
  capabilities: SalesCapabilities,
  actions: SalesTypedActionCatalog,
  events: SalesTypedEventCatalog,
  consumes: [],
  http: ["Sales"],
  extensionPoints: [{ kind: "custom-fields", documentType: "sales.customer" }],
  pages: ["/sales", "/sales/customers/:id", "/sales/quotations/:id", "/sales/orders/:id"],
})
