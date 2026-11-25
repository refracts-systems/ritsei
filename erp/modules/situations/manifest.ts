import { defineModule } from "../../../framework/modules/module/mod.ts"
import { SituationsCapabilities } from "./src/capabilities.ts"
import { SituationsTypedEventCatalog } from "./src/events.ts"

export const SituationsModule = defineModule({
  name: "situations",
  layer: "erp",
  dependsOn: ["billing", "settlement"],
  schemas: ["situations"],
  capabilities: SituationsCapabilities,
  actions: [],
  events: SituationsTypedEventCatalog,
  consumes: [],
  http: ["Situations"],
  pages: [],
})
