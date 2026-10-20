import { defineModule } from "../../../framework/modules/module/mod.ts"
import { TaxCapabilities } from "./src/capabilities.ts"

export const TaxModule = defineModule({
  name: "tax",
  layer: "erp",
  dependsOn: [],
  schemas: ["tax"],
  capabilities: TaxCapabilities,
  actions: [],
  events: [],
  consumes: [],
  http: ["Tax"],
  pages: ["/tax"],
})
