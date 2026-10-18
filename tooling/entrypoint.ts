import { argv } from "node:process"
import { pathToFileURL } from "node:url"

/** Node equivalent of Deno's `import.meta.main` entrypoint check. */
export const isMain = (moduleUrl: string): boolean =>
  argv[1] !== undefined && moduleUrl === pathToFileURL(argv[1]).href
