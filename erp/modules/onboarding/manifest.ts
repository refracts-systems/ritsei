import { defineModule } from "../../../framework/modules/module/mod.ts"
import { OnboardingCapabilities } from "./src/capabilities.ts"

export const OnboardingModule = defineModule({
  name: "onboarding",
  layer: "erp",
  dependsOn: ["party"],
  schemas: ["onboarding"],
  capabilities: OnboardingCapabilities,
  actions: [],
  events: [],
  consumes: [],
  http: ["Onboarding"],
  pages: ["/onboarding", "/onboarding/:id"],
})
