import { defineModule } from "../../framework/modules/module/mod.ts"
import { HelpdeskCapabilities } from "./src/capabilities.ts"

export const HelpdeskModule = defineModule({
  name: "helpdesk",
  layer: "extensions",
  dependsOn: ["situations"],
  schemas: ["helpdesk"],
  capabilities: HelpdeskCapabilities,
  actions: [],
  events: [],
  consumes: [],
  http: ["Helpdesk"],
  pages: [],
})
