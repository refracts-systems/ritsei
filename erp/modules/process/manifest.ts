import { defineModule } from "../../../framework/modules/module/mod.ts"
import { ProcessCapabilities } from "./src/capabilities.ts"
import { ProcessTypedEventCatalog } from "./src/catalog.ts"

export const ProcessModule = defineModule({
  name: "process",
  layer: "erp",
  dependsOn: ["accounting", "inventory", "party", "procurement", "product", "sales"],
  schemas: ["process"],
  capabilities: ProcessCapabilities,
  actions: [],
  events: ProcessTypedEventCatalog,
  consumes: [],
  http: ["Process"],
  pages: ["/processes", "/processes/:id"],
})
