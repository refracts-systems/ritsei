import { assert, describe, it } from "@effect/vitest"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(path, "utf8")

describe("roadmap track contracts", () => {
  it("keeps workload classification separate from authorization and business authority", () => {
    const source = read("docs/architecture/workload-isolation.md")
    assert.include(source, "workload class")
    assert.include(source, "command_reserved > 0")
    assert.include(source, "adaptive_limit <= hard_limit")
    assert.include(source, "Criticality is not authorization priority")
    assert.include(source, "fall back from query to command resources")
  })

  it("keeps the frontend as a typed, separately deployed SPA", () => {
    const source = read("docs/architecture/frontend.md")
    assert.include(source, "Vite")
    assert.include(source, "SolidJS 2.0 SPA")
    assert.include(source, "TanStack Solid Query")
    assert.include(source, "Effect Schema")
    assert.include(source, "The browser must not connect directly to PostgreSQL")
    assert.include(source, "no frontend code imports backend internals")
  })

  it("keeps production claims behind reviewed artifacts and profile approval", () => {
    const deployment = read("deploy/entry/README.md")
    const release = read("docs/development/releasing.md")
    assert.include(deployment, "not production HA evidence")
    assert.include(deployment, "RITSEI_DEPLOYMENT_PROFILE=entry")
    assert.include(release, "source-only snapshots")
    assert.include(release, "supported upgrade path")
  })
})
