import { defineModule } from "../../../framework/modules/module/mod.ts"
import { ProductCapabilities } from "./src/capabilities.ts"

export const ProductModule = defineModule({
  name: "product",
  layer: "erp",
  dependsOn: [],
  schemas: ["product"],
  capabilities: ProductCapabilities,
  actions: [],
  events: [],
  consumes: [],
  http: ["Product"],
  pages: ["/product"],
})
