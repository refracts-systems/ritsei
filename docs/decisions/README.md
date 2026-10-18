# Architecture Decision Records

> **Related documents**
>
> - Canonical architecture:
>   [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Documentation workflow:
>   [`../development/documentation-workflow.md`](../development/documentation-workflow.md)
> - Decision map: [`./decision-map.md`](./decision-map.md)
> - ADR template: [`./0000-template.md`](./0000-template.md)

ADRs preserve why architectural choices were made. Canonical architecture documents describe the
current system; ADRs preserve decision history.

## Status Values

- Proposed
- Accepted
- Rejected
- Deprecated
- Superseded

## Index

| ADR                                                                  | Decision                                                        | Status     |
| -------------------------------------------------------------------- | --------------------------------------------------------------- | ---------- |
| [`0001`](./0001-use-modular-monolith.md)                             | Use a modular monolith                                          | Accepted   |
| [`0002`](./0002-use-effect-deno-and-drizzle.md)                      | Use Effect, Deno, and Drizzle                                   | Accepted   |
| [`0003`](./0003-postgresql-is-transactional-truth.md)                | PostgreSQL is transactional truth                               | Superseded |
| [`0004`](./0004-separate-events-jobs-and-workflows.md)               | Separate events, jobs, and workflows                            | Accepted   |
| [`0005`](./0005-use-ltree-and-sql-pgq-selectively.md)                | Use `ltree` and SQL/PGQ selectively                             | Accepted   |
| [`0006`](./0006-use-capability-based-authorization.md)               | Use scoped capability authorization                             | Accepted   |
| [`0007`](./0007-adopt-tiered-plugin-trust.md)                        | Adopt tiered plugin trust                                       | Accepted   |
| [`0008`](./0008-gate-zig-behind-benchmarks.md)                       | Gate Zig behind benchmarks                                      | Accepted   |
| [`0009`](./0009-use-solidjs-2.md)                                    | Use SolidJS 2.0 for the frontend                                | Accepted   |
| [`0010`](./0010-use-vite-solidjs-spa.md)                             | Use a Vite-based SolidJS SPA                                    | Accepted   |
| [`0011`](./0011-financial-ledger-engine.md)                          | Financial ledger execution engine                               | Superseded |
| [`0012`](./0012-use-drizzle-schema-flow-and-effect-http.md)          | Use the Drizzle schema flow and Effect-native HTTP              | Accepted   |
| [`0013`](./0013-version-external-standard-adapters.md)               | Isolate external standards behind versioned adapters            | Accepted   |
| [`0014`](./0014-separate-internal-and-external-identifiers.md)       | Separate internal identity from external identifiers            | Accepted   |
| [`0015`](./0015-one-semantic-owner-per-invariant.md)                 | Assign one semantic owner per invariant                         | Accepted   |
| [`0016`](./0016-isolate-jurisdiction-localization.md)                | Isolate localization from primitive cores                       | Accepted   |
| [`0017`](./0017-use-effect-platform-deno.md)                         | Use the canonical Effect Deno adapter                           | Accepted   |
| [`0018`](./0018-adopt-typed-process-studio.md)                       | Adopt a typed, domain-aware Process Studio                      | Accepted   |
| [`0019`](./0019-adopt-integration-surface-profile.md)                | Adopt a typed external integration surface profile              | Accepted   |
| [`0020`](./0020-adopt-capability-release-and-runtime-governance.md)  | Adopt capability release and runtime governance                 | Accepted   |
| [`0021`](./0021-define-p0-scope-and-identity-model.md)               | Define the P0 scope and identity model                          | Accepted   |
| [`0022`](./0022-update-effect-v4-to-beta-103.md)                     | Update Effect v4 and Deno adapter to beta.103                   | Accepted   |
| [`0023`](./0023-adopt-capability-oriented-plugin-contribution.md)    | Adopt capability-oriented plugin contribution                   | Accepted   |
| [`0024`](./0024-adopt-effect-schema-as-canonical-contract-schema.md) | Adopt Effect Schema as the canonical contract schema            | Accepted   |
| [`0025`](./0025-introduce-stateful-entity-runtime.md)                | Introduce a Stateful Entity Runtime                             | Accepted   |
| [`0026`](./0026-evaluate-celld-runtime-adapter.md)                   | Evaluate `celld` as the distributed runtime adapter             | Proposed   |
| [`0027`](./0027-adopt-postgresql-first-replaceable-search.md)        | Adopt PostgreSQL-first, replaceable search                      | Accepted   |
| [`0028`](./0028-complete-p0-identity-party-and-branch-metadata.md)   | Complete P0 identity-party and branch metadata boundaries       | Accepted   |
| [`0029`](./0029-rename-user-and-party-public-vocabulary.md)          | Rename user and Party public vocabulary                         | Accepted   |
| [`0030`](./0030-user-account-lifecycle-and-tenant-membership.md)     | Separate UserAccount lifecycle from tenant membership           | Accepted   |
| [`0031`](./0031-capability-naming-and-business-verb-conventions.md)  | Define capability naming and business verb conventions          | Accepted   |
| [`0032`](./0032-order-confirmation-cross-domain-workflow.md)         | Define atomic Sales + Inventory + Accounting order confirmation | Superseded |
| [`0033`](./0033-extend-order-lifecycle-and-gate-pgque.md)            | Extend order lifecycle and gate PgQue activation                | Accepted   |
| [`0034`](./0034-adopt-non-interference-overload-isolation.md)        | Adopt non-interference as the overload-isolation target         | Accepted   |
| [`0035`](./0035-define-p1-inventory-primitives.md)                   | Define the P1 inventory primitive baseline                      | Accepted   |
| [`0036`](./0036-define-p2-document-and-financial-baseline.md)        | Define the P2 document and financial baseline                   | Accepted   |
| [`0037`](./0037-define-p3-audit-event-and-delivery-boundary.md)      | Define the P3 audit, event, and delivery boundary               | Accepted   |
| [`0038`](./0038-move-internal-event-delivery-to-messaging.md)        | Move internal event delivery ownership to Messaging             | Accepted   |
| [`0039`](./0039-select-postgresql-wait-for-for-replica-read-your-writes.md) | Select PostgreSQL `WAIT FOR` for replica read-your-writes | Accepted |
| [`0040`](./0040-adopt-tigerbeetle-financial-ledger.md)                 | Adopt TigerBeetle as the financial ledger execution engine     | Accepted   |
| [`0041`](./0041-separate-deployment-profile-and-financial-authority.md) | Separate deployment profile from financial authority          | Accepted   |
| [`0042`](./0042-exact-financial-amount-boundary.md)                 | Set an exact financial amount boundary above the target       | Accepted   |
| [`0043`](./0043-adopt-rebuildable-analytic-plane.md)                | Adopt a rebuildable Analytic Plane                            | Accepted   |
| [`0044`](./0044-define-procurement-purchase-order-baseline.md)       | Define the Procurement Purchase Order baseline                | Accepted   |
| [`0045`](./0045-define-procurement-purchase-order-confirmation.md)   | Define Procurement Purchase Order confirmation                | Accepted   |
| [`0046`](./0046-adopt-owner-local-business-surface-and-generated-ergonomics.md) | Adopt owner-local business surface and generated structural ergonomics | Accepted |
| [`0047`](./0047-define-procurement-goods-receipt-boundary.md) | Define the Procurement Goods Receipt boundary | Accepted |
| [`0048`](./0048-define-effect-application-architecture-and-frontend-state-ownership.md) | Define Effect application architecture and frontend state ownership | Accepted |
| [`0049`](./0049-keep-solid-compiler-at-rendering-boundary.md) | Keep the Solid compiler at the rendering boundary | Accepted |
| [`0050`](./0050-use-package-json-for-deno-dependency-resolution.md) | Use package.json and npm exports for Deno dependency resolution | Superseded |
| [`0051`](./0051-adopt-uuidv7-for-persistent-identities.md) | Adopt UUIDv7 for persistent identities | Accepted |
| [`0052`](./0052-separate-lease-capability-and-fencing-generation.md) | Separate lease capability from fencing generation | Accepted |
| [`0053`](./0053-clarify-per-job-lease-generation-invariants.md) | Clarify per-job lease-generation invariants | Accepted |
| [`0054`](./0054-keep-fencing-and-idempotency-identities-orthogonal.md) | Keep fencing and idempotency identities orthogonal | Accepted |
| [`0055`](./0055-use-explicit-fence-scopes-for-shared-job-streams.md) | Use explicit fence scopes for shared job streams | Accepted |
| [`0056`](./0056-adopt-ritsei-semantic-frontend-design-system.md) | Adopt the RITSEI semantic frontend design system | Superseded |
| [`0057`](./0057-define-layered-tanstack-frontend-engine-boundaries.md) | Define layered TanStack frontend engine boundaries | Accepted |
| [`0058`](./0058-define-provider-neutral-identity-and-authentication-boundary.md) | Define provider-neutral identity and authentication boundary; recommend ZITADEL | Accepted |
| [`0059`](./0059-define-replaceable-relationship-authorization-engine.md) | Define replaceable relationship authorization engine; support SpiceDB | Accepted |
| [`0060`](./0060-defer-billing-and-settlement-scope.md) | Defer Billing and settlement scope until ownership is ready | Accepted |
| [`0061`](./0061-correct-roadmap-gate-granularity.md) | Require executable evidence for roadmap gate completion | Accepted |
| [`0062`](./0062-adopt-fallow-for-generic-static-analysis.md) | Adopt Fallow for generic static analysis | Accepted |
| [`0063`](./0063-define-governed-ai-recommendation-and-agent-boundary.md) | Define governed AI recommendation and agent boundary | Accepted |
| [`0064`](./0064-propose-gcp-financial-staging-platform.md) | Propose GCP as the first financial staging platform | Proposed |
| [`0065`](./0065-propose-cloudflare-financial-edge-evidence-plane.md) | Propose Cloudflare as the financial edge and evidence plane | Proposed |
| [`0066`](./0066-adopt-single-product-semver-authority.md) | Adopt a single product SemVer authority | Accepted |
| [`0067`](./0067-separate-logical-database-and-physical-data-placement.md) | Separate logical database from physical data placement | Accepted |
| [`0068`](./0068-establish-foundation-modules-platform-runtime-taxonomy.md) | Establish foundation, modules, platform, and runtime taxonomy | Accepted |
| [`0069`](./0069-adopt-cartographic-enterprise-visual-grammar.md) | Adopt the cartographic enterprise visual grammar | Superseded |
| [`0070`](./0070-select-vgpu-and-defer-typegpu.md) | Select `vgpu` as the optional cartographic renderer and defer TypeGPU compute | Accepted |
| [`0071`](./0071-adopt-universal-cartographic-archetypes.md) | Adopt seven universal cartographic visual archetypes | Superseded |
| [`0072`](./0072-prefer-native-solid-reactivity-for-effect-integration.md) | Prefer native Solid 2 reactivity for Effect integration | Accepted |
| [`0073`](./0073-simplify-repository-enforcement-tooling.md) | Simplify repository enforcement tooling | Accepted |
| [`0074`](./0074-switch-to-kobalte-for-solid2-accessible-primitives.md) | Use Kobalte for Solid 2 accessible primitives | Accepted |
| [`0075`](./0075-partition-dependency-ownership-by-application-boundary.md) | Partition dependency ownership by application boundary | Accepted |
| [`0076`](./0076-adopt-ritsei-typography-system.md) | Adopt the RITSEI typography system | Accepted |
| [`0077`](./0077-adopt-ritsei-iconography-system.md) | Adopt the RITSEI iconography system | Accepted |
| [`0078`](./0078-adopt-ritsei-motion-system.md) | Adopt the RITSEI motion system | Accepted |
| [`0079`](./0079-gate-dnd-kit-solid2-activation.md) | Gate dnd-kit activation on Solid 2 compatibility | Accepted |
| [`0080`](./0080-adopt-solid-native-boneyard-skeleton-boundary.md) | Adopt a Solid-native Boneyard skeleton boundary | Accepted |
| [`0081`](./0081-adopt-document-ast-rendering-platform.md) | Adopt a Document AST rendering platform | Proposed |
| [`0082`](./0082-adopt-communication-platform-boundaries.md) | Adopt SAP-separated communication platform boundaries | Accepted |
| [`0083`](./0083-enforce-non-interference-between-source-of-truth-and-derived-capabilities.md) | Enforce non-interference between source-of-truth and derived capabilities | Accepted |
| [`0084`](./0084-establish-explicit-progressive-trust-boundaries.md) | Establish explicit progressive trust boundaries | Proposed |
| [`0085`](./0085-separate-tanstack-adapters-from-semantic-ui-contracts.md) | Separate TanStack adapters from semantic UI contracts | Accepted |
| [`0086`](./0086-promote-solid-effect-bridge-to-production-boundary.md) | Promote the Solid 2 × Effect bridge to the production boundary | Accepted |
| [`0087`](./0087-adopt-node-lts-and-pnpm-toolchain.md) | Adopt Node.js LTS and pnpm as the repository toolchain | Accepted |
| [`0088`](./0088-adopt-oxc-formatting-and-linting.md) | Adopt Oxc formatting and linting | Accepted |
| [`0089`](./0089-retire-roadmap-completion-evaluator.md) | Retire the roadmap completion evaluator | Accepted |
| [`0090`](./0090-adopt-operational-clarity-visual-language.md) | Adopt the Operational Clarity visual language | Accepted |

Accepted ADRs must not be rewritten to alter history. Create a new ADR and use `Supersedes`.
