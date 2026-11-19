// Deny by default: a tenant administrator must grant each capability before it takes effect.
export const OnboardingCapabilities = {
  importStage: "onboarding.import.stage",
  importRead: "onboarding.import.read",
  importRehearse: "onboarding.import.rehearse",
  importApply: "onboarding.import.apply",
} as const
