import { defineModule } from "../../../framework/modules/module/mod.ts"
import { InventoryCapabilities } from "./src/capabilities.ts"
import { InventoryTypedActionCatalog, InventoryTypedEventCatalog } from "./src/catalog.ts"

export const InventoryModule = defineModule({
  name: "inventory",
  layer: "erp",
  dependsOn: ["accounting", "product"],
  schemas: ["inventory"],
  capabilities: InventoryCapabilities,
  actions: InventoryTypedActionCatalog,
  events: InventoryTypedEventCatalog,
  consumes: [],
  http: ["Inventory"],
  pages: ["/inventory", "/inventory/:id"],
})
