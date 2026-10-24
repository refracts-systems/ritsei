import { build } from "vite"

import { isMain } from "../entrypoint.ts"

// A real bundler probe: package metadata alone does not prove Solid 2 compatibility.
const probeSolidPackage = async (entry: string) => {
  try {
    await build({
      configFile: "apps/web/vite.config.ts",
      root: ".",
      logLevel: "silent",
      build: {
        write: false,
        lib: { entry, formats: ["es"] },
      },
    })

    return { build: "passed" as const, behavior: "unreviewed" as const }
  } catch (cause) {
    return { build: "blocked" as const, diagnostic: String(cause) }
  }
}

export const probeKobalteCompatibility = () =>
  probeSolidPackage("apps/web/src/ui/compatibility/kobalte.tsx")

export const probeDndCompatibility = () =>
  probeSolidPackage("apps/web/src/ui/compatibility/dnd.tsx")

const extractBundleCode = (result: Awaited<ReturnType<typeof build>>): string =>
  (Array.isArray(result) ? result : [result])
    .flatMap((value) => ("output" in value ? value.output : []))
    .flatMap((asset) => (asset.type === "chunk" ? [asset.code] : []))
    .join("\n")

export const probeBoneyardCoreCompatibility = async () => {
  try {
    const result = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        lib: {
          entry: "apps/web/src/ui/compatibility/boneyard.ts",
          formats: ["es"],
        },
      },
    })

    const code = extractBundleCode(result)
    const forbidden = code.match(/\b(?:react|react-dom|playwright)\b/i)

    if (forbidden) {
      return {
        build: "blocked" as const,
        diagnostic: `Production bundle contains ${forbidden[0]}`,
      }
    }

    return {
      build: "passed" as const,
      productionBundle: "safe" as const,
      behavior: "unreviewed" as const,
    }
  } catch (cause) {
    return { build: "blocked" as const, diagnostic: String(cause) }
  }
}

if (isMain(import.meta.url)) {
  const result = await probeKobalteCompatibility()
  console.log(JSON.stringify(result, null, 2))

  // A successful bundle still needs the dialog's browser/accessibility evidence.
  if (result.build === "blocked") process.exit(1)
}
