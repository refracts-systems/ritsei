import { readdir, readFile } from "node:fs/promises"

export interface SourceFile {
  readonly path: string
  readonly source: string
}

const ignoredDirectories = new Set(["node_modules", "vendor", ".auto"])
const ignoredPaths = [
  "apps/web/src/ui/generated",
  "apps/web/src/shared/contracts/generated",
  "apps/web/dist",
  "apps/web/src/experiments/solid-effect",
]

export const isIgnoredSourcePath = (path: string): boolean => {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "")
  return (
    normalized.split("/").some((part) => ignoredDirectories.has(part)) ||
    ignoredPaths.some(
      (ignored) =>
        normalized === ignored ||
        normalized.startsWith(`${ignored}/`) ||
        normalized.endsWith(`/${ignored}`) ||
        normalized.includes(`/${ignored}/`),
    )
  )
}

export const collectSourceFiles = async (
  directory: string,
  extensions?: readonly string[],
): Promise<readonly SourceFile[]> => {
  const files: SourceFile[] = []
  const visit = async (path: string): Promise<void> => {
    if (isIgnoredSourcePath(path)) return
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = `${path}/${entry.name}`
      if (entry.isDirectory()) {
        await visit(child)
      } else if (
        entry.isFile() &&
        (extensions === undefined || extensions.some((extension) => entry.name.endsWith(extension)))
      ) {
        files.push({
          path: child.replaceAll("\\", "/"),
          source: await readFile(child, "utf8"),
        })
      }
    }
  }

  try {
    await visit(directory)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause
  }
  return files
}
