import { defineModule } from "../../../framework/modules/module/mod.ts"
import { ProcurementCapabilities } from "./src/capabilities.ts"
import { ProcurementTypedActionCatalog, ProcurementTypedEventCatalog } from "./src/catalog.ts"

export const ProcurementModule = defineModule({
  name: "procurement",
  layer: "erp",
  dependsOn: ["accounting", "inventory", "party", "product", "tax"],
  schemas: ["procurement"],
  capabilities: ProcurementCapabilities,
  actions: ProcurementTypedActionCatalog,
  events: ProcurementTypedEventCatalog,
  consumes: [],
  http: ["Procurement"],
  pages: ["/procurement", "/procurement/:id"],
})
