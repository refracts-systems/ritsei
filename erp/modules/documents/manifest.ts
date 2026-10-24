import { defineModule } from "../../../framework/modules/module/mod.ts"

export const DocumentsModule = defineModule({
  name: "documents",
  layer: "erp",
  dependsOn: ["billing", "procurement", "sales", "settlement"],
  schemas: [],
  capabilities: {},
  actions: [],
  events: [],
  consumes: [],
  http: ["Documents"],
  pages: [],
})
