import { defineModule } from "../../../framework/modules/module/mod.ts"

export const BillingModule = defineModule({
  name: "billing",
  layer: "erp",
  dependsOn: [],
  schemas: ["billing"],
  capabilities: {},
  actions: [],
  events: [],
  consumes: [],
  http: [],
  pages: [],
})
