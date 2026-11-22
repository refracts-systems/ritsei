/**
 * Effect Cluster host for the domain model port (ADR-0124, phase 0).
 *
 * A thin pass-through to the host's `layerEntities`. It opens its own PostgreSQL pool from
 * `CLUSTER_DATABASE_URL` and keeps aggregate state in `alchemy_domain_objects`, which a reviewed
 * migration creates. The pool is passed in, so this adapter pulls in no deployment package.
 * Constructed here, not used by production code until an aggregate moves (phase 1 or later).
 */
export {
  layerEntities as layerDomainModelCluster,
  type EntitiesOptions as DomainModelClusterOptions,
} from "@alchemy.run/domain/EffectCluster"

/** The runner pool the host deploys its entity to; callers build it with their pool provider. */
export type { PoolLayer as DomainModelPool } from "@alchemy.run/effect-cluster/Pool"
