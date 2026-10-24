import { defineModule } from "../../../framework/modules/module/mod.ts"
import { BillingCapabilities } from "./src/capabilities.ts"

export const BillingModule = defineModule({
  name: "billing",
  layer: "erp",
  dependsOn: ["accounting", "party", "procurement", "product", "sales", "tax"],
  schemas: ["billing"],
  capabilities: BillingCapabilities,
  actions: [],
  events: [],
  consumes: [],
  http: ["Billing"],
  pages: [],
})
