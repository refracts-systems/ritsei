import { defineModule } from "../../../framework/modules/module/mod.ts"
import { PartyCapabilities } from "./src/capabilities.ts"
import { PartyTypedActionCatalog, PartyTypedEventCatalog } from "./src/catalog.ts"

export const PartyModule = defineModule({
  name: "party",
  layer: "erp",
  dependsOn: [],
  schemas: ["party"],
  capabilities: PartyCapabilities,
  actions: PartyTypedActionCatalog,
  events: PartyTypedEventCatalog,
  consumes: [],
  http: ["Parties"],
  pages: ["/parties", "/parties/:id"],
})
