import { defineModule } from "../../../framework/modules/module/mod.ts"
import { SalesCapabilities } from "./src/capabilities.ts"
import { SalesTypedActionCatalog, SalesTypedEventCatalog } from "./src/catalog.ts"

export const SalesModule = defineModule({
  name: "sales",
  layer: "erp",
  dependsOn: [],
  schemas: ["sales"],
  capabilities: SalesCapabilities,
  actions: SalesTypedActionCatalog,
  events: SalesTypedEventCatalog,
  consumes: [],
  http: ["Sales"],
  pages: ["/sales"],
})
