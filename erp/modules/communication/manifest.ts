import { defineModule } from "../../../framework/modules/module/mod.ts"
import { CommunicationCapabilities } from "./src/capabilities.ts"

export const CommunicationModule = defineModule({
  name: "communication",
  layer: "erp",
  dependsOn: ["procurement"],
  schemas: [],
  capabilities: CommunicationCapabilities,
  actions: [],
  events: [],
  consumes: ["procurement.purchase_order.confirmed"],
  http: [],
  pages: [],
})
