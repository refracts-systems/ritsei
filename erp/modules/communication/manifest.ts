import { defineModule } from "../../../framework/modules/module/mod.ts"

export const CommunicationModule = defineModule({
  name: "communication",
  layer: "erp",
  dependsOn: ["procurement"],
  schemas: [],
  capabilities: {},
  actions: [],
  events: [],
  consumes: ["procurement.purchase_order.confirmed"],
  http: [],
  pages: [],
})
