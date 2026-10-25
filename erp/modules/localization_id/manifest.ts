import { defineModule } from "../../../framework/modules/module/mod.ts"
import { LocalizationIdCapabilities } from "./src/capabilities.ts"

export const LocalizationIdModule = defineModule({
  name: "localization_id",
  layer: "erp",
  dependsOn: ["accounting", "party", "tax"],
  schemas: [],
  capabilities: LocalizationIdCapabilities,
  actions: [],
  events: [],
  consumes: [],
  http: ["LocalizationId"],
  pages: [],
})
