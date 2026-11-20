import { assert, it } from "@effect/vitest"

import { layerDomainModelCluster } from "../mod.ts"

// Loading the adapter proves the host's entry points resolve and import under Node. Building the
// layer needs a runner pool and CLUSTER_DATABASE_URL, which the phase 0 pool step covers.
it("loads the Effect Cluster host adapter", () => {
  assert.isFunction(layerDomainModelCluster)
})
