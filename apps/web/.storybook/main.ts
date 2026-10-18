import { defineMain } from "storybook-solidjs-vite"

export default defineMain({
  framework: { name: "storybook-solidjs-vite" },
  stories: ["../src/ui/**/*.stories.@(ts|tsx)"],
  // Serves the static icon sprite (/icons/phosphor.svg) used by the Icon component.
  staticDirs: ["../public"],
})
