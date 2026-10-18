import { createServer } from "node:http"

/**
 * Node-side server factory handed to the Effect HTTP adapter. The composition
 * roots in `runtime/api` must not import `node:http` directly; this adapter is
 * the single seam where the Node HTTP server is constructed.
 */
export const createNodeServer = () => createServer()
