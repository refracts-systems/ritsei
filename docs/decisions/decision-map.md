# Decision Map

> **Status:** Reference navigation
>
> **Owns:** Decision lineage and a concise map of current architectural rules.
>
> **Does not own:** Binding architecture, domain contracts, persistence rules, or implementation
> behavior. Those remain owned by the linked ADRs and canonical architecture documents.
>
> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Documentation boundaries: [`../documentation-boundaries.md`](../documentation-boundaries.md)

ADRs preserve the decisions and trade-offs that were accepted at a point in time. This map explains
how related decisions fit together without rewriting their historical text. ADR-0074 is the current
accessible-primitive selection; ADR-0056 remains the historical design-system decision for its other
active boundaries. ADR-0075 is the current dependency-ownership boundary for workspace members.
ADR-0076 is the current typography direction and semantic text-style boundary.
ADR-0077 is the current semantic iconography and provider-adapter boundary.
ADR-0078 is the current motion ownership and runtime-wrapper boundary.
ADR-0079 is the current dnd-kit/Solid 2 activation gate and blocked-state boundary.
ADR-0080 is the current Solid-native Boneyard skeleton boundary.
ADR-0081 is the proposed renderer-independent Document AST and document-rendering platform boundary.
ADR-0082 is the current SAP-separated Communication Platform and Activity Timeline projection boundary.
ADR-0084 is a proposed cross-cutting progressive trust model; it is not an active canonical rule until accepted.
ADR-0085 is the current frontend public-contract refinement: TanStack adapters stay internal and semantic UI stays public. ADR-0086 is the current production implementation boundary for the native Solid 2 × Effect bridge.

## Current decision lineage

```text
ADR-0015  One semantic owner per invariant
    |
    +--> ADR-0036  Owner-local documents and bounded financial baseline
              |
              +--> ADR-0081  Proposed Document AST rendering platform
              |           +--> owner-local snapshots remain business authority
              |           +--> renderer families stay behind capability adapters
              |           +--> browser rendering remains an explicit compatibility path
              |
              +--> ADR-0044  Procurement Purchase Order baseline
              |
              +--> ADR-0045  Procurement Purchase Order confirmation

ADR-0037 / ADR-0038  Audit, external delivery, and internal messaging boundaries
    |
    +--> ADR-0082  SAP-separated Communication Platform boundaries
              +--> domain facts enter the transactional outbox; application communication policy derives intents
              +--> explicit user/process requests may create intents directly
              +--> recipients, contexts, templates, artifacts, and attempts stay separate
              +--> Activity Timeline is a rebuildable projection, not a `chatter_messages` authority

ADR-0050  Package.json-based Deno dependency resolution
    |
    +--> ADR-0075  Dependency ownership follows application boundaries
              +--> root package.json owns repository-wide dependencies and tooling
              +--> apps/web/package.json owns web-only dependencies and exact pins
              +--> deno.lock remains the single resolved workspace graph

ADR-0010  Vite-based SolidJS SPA
    |
    +--> ADR-0056  RITSEI semantic frontend design system
              |
              +--> Ark UI was the historical primitive selection
              +--> Panda CSS is a constrained styling substrate
              +--> Product Patterns and Visual Grammar become canonical
              |
              +--> ADR-0074 selects Kobalte for the Solid 2 primitive boundary
              |
              +--> ADR-0076 adopts Pretendard for product UI, IBM Plex Mono for technical values,
              |           and semantic typography tokens with a future Söhne brand layer
              |
              +--> ADR-0077 adopts semantic icon names, Phosphor now, and a replaceable Nucleo adapter
              |
              +--> ADR-0078 adopts PandaCSS-first motion with Motion for runtime spatial behavior
              |
              +--> ADR-0079 gates dnd-kit activation on a real Solid 2 build and browser proof
              |
              +--> ADR-0080 adopts a Solid-native Boneyard skeleton boundary
              |
              +--> ADR-0057 layered TanStack frontend engine boundaries
                        +--> Query is selective server-state cache policy
                        +--> Table, Virtual, and Form are headless ERP engines
                        +--> Pacer is optional; DB remains research-only
              |
              +--> ADR-0085 separates internal TanStack adapters from public semantic UI
                        +--> DataTable/Form and semantic fields are public contracts
                        +--> query and virtualizer adapters are policy-owned and internal
              |
              +--> ADR-0072 native Solid 2 and Effect integration
                        +--> Solid owns the default reactive graph and ownership tree
                        +--> Solid Context carries the scoped Effect ManagedRuntime and `R`
                        +--> Effect Atom is opt-in for shared or portable reactive graphs
                                  +--> ADR-0086 promotes the bridge to `apps/web/src/shared/solid-effect.ts`
                                      and keeps the experiment as a re-exporting evidence harness
              |
              +--> ADR-0069 cartographic enterprise visual grammar (superseded by ADR-0090)
                        +--> HTML owns semantics and interaction
                        +--> WebGPU is optional and fallback-first
                        +--> material ratios are art direction, not a page template
                        +--> ADR-0070 selects vgpu behind a RITSEI renderer adapter
                                  +--> TypeGPU is deferred for future GPU-compute workloads
                        +--> ADR-0071 adopts seven universal cartographic archetypes
                                  +--> deterministic variation and semantic depth
              |
              +--> ADR-0090 Operational Clarity visual language
                        +--> neutral surfaces, one cobalt accent, status color only for status
                        +--> light icon navigation, 48px topbar, compact density
                        +--> cartography renderer kept as a visualization tool only

ADR-0030  UserAccount lifecycle and tenant membership
    |
    +--> ADR-0058 provider-neutral identity and authentication boundary
              +--> selected IdentityProvider owns provider identity, credentials, and sessions
              +--> ZITADEL is recommended, not required
              +--> RITSEI owns UserAccount mapping and tenant membership
              +--> provider claims never become ERP capabilities

ADR-0006  Scoped capability authorization
    |
    +--> ADR-0059 replaceable RelationshipEngine
              +--> native PostgreSQL is the default implementation
              +--> SpiceDB is an optional high-scale adapter
              +--> RITSEI/PostgreSQL remains canonical AuthZ authority
              +--> permission matrix remains the coarse gate
              +--> domain policy and SoD remain outside the engine

ADR-0024 / ADR-0058 / ADR-0059 / ADR-0063
    |
    +--> ADR-0084  Proposed explicit progressive trust boundaries
              +--> external representations gain no RITSEI identity, authority, or business fact by default
              +--> runtime decoding, identity, authorization, domain, and resource boundaries remain explicit
              +--> intent and commands cannot bypass owner-controlled deterministic execution

ADR-0034  Non-interference overload isolation
    |
    +--> ADR-0083 source-of-truth and derived-capability non-interference
              +--> Class A source-of-truth paths do not depend on unrelated Class B/C capabilities
              +--> committed facts and outbox records precede derived work
              +--> derived failures, retries, resources, and rebuilds remain local
              +--> ADR-0034 remains the detailed workload/resource proof owner
    |
    +--> ADR-0067 logical database and physical data placement
              +--> semantic ownership remains independent of placement
              +--> logical database endpoints hide private topology
              +--> transaction and consistency boundaries remain explicit
              +--> sharding remains evidence-gated

ADR-0001  Modular monolith
    |
    +--> ADR-0068 foundation, modules, platform, and runtime taxonomy
              +--> generic contracts live in foundation
              +--> business capabilities live in modules
              +--> concrete adapters live in platform
              +--> composition roots live in runtime

ADR-0046  Owner-local business surface + generated structural ergonomics
    |
    +--> concrete business objects remain owner-local
    +--> ordinary structural changes may use reviewed CRUD-like helpers
    +--> meaningful transitions use explicit actions
    +--> consequential facts remain with their semantic owner
    +--> generated tooling is not business authority
              |
              +--> ADR-0047  Procurement Goods Receipt boundary
```

ADR-0046 amends the current architectural interpretation of ADR-0015 and ADR-0036. ADR-0047
amends the receipt and cancellation boundary of ADR-0044 and ADR-0045. ADR-0056 historically amended only the
frontend primitive and styling selection recorded by ADR-0010; ADR-0074 now supersedes its
accessible-primitive selection while retaining its Panda and Product Pattern boundaries. ADR-0057 clarifies the role and
adoption scope of the TanStack frontend engines; ADR-0072 defines the native Solid 2 and Effect
integration boundary without rejecting optional Atom use; ADR-0086 promotes that bridge's
implementation to the production frontend boundary; ADR-0058 amends only the authentication/session
provider boundary in ADR-0030; ADR-0059 defines the replaceable RelationshipEngine boundary in
ADR-0006; ADR-0070 concretizes the optional cartographic renderer selected by ADR-0069 without
changing its HTML-first, fallback-first semantics; and ADR-0071 replaces coarse industry categories
with seven universal cartographic archetypes, context-aware semantic mappings, deterministic
variation, and semantic depth. ADR-0090 supersedes ADR-0069 and ADR-0071 as the product's visual
language, keeping the cartography renderer and ADR-0070 only as a visualization tool. ADR-0073 supersedes the custom-checker selection portion of ADR-0062;
ADR-0075 supersedes the dependency-manifest ownership portion of ADR-0050 while retaining package.json
and deno.lock-based resolution; it deliberately defers a root catalog until multiple workspace members
share a version invariant. ADR-0076 amends the typography direction in ADR-0056 without changing
its Panda styling boundary. ADR-0077 amends the iconography direction in ADR-0056 while preserving
its provider-neutral design-system boundary. ADR-0078 amends the motion direction in ADR-0056 while
preserving Solid state ownership and Kobalte accessibility ownership. ADR-0079 records the dnd-kit
provider target but blocks activation until its Solid 2 compatibility evidence passes. ADR-0080
records Boneyard as a static geometry provider behind a Solid-native RITSEI Skeleton boundary while
ADR-0072 remains the reactive ownership authority. Fallow and ast-grep remain the generic enforcement owners while only
path-sensitive RITSEI checks remain custom. Both providers remain optional adapters; the RITSEI
contracts and authority remain active. The rest of those decisions remains active. None of these
amendments rewrite historical decisions, and ADR-0047 does not change the financial authority recorded
by ADR-0040.

## Relationship matrix

| Decision | Relation | Current role |
|---|---|---|
| [ADR-0015](./0015-one-semantic-owner-per-invariant.md) | Amended interpretation | One owner remains authoritative for each invariant |
| [ADR-0036](./0036-define-p2-document-and-financial-baseline.md) | Amended interpretation | Documents remain owner-local; unresolved financial families remain gated |
| [ADR-0040](./0040-adopt-tigerbeetle-financial-ledger.md) | Compatible | Accounting semantics use `FinancialLedgerPort`; ledger execution remains separate |
| [ADR-0044](./0044-define-procurement-purchase-order-baseline.md) | Compatible | Procurement owns Purchase Order identity and lifecycle |
| [ADR-0045](./0045-define-procurement-purchase-order-confirmation.md) | Compatible | Purchase Order confirmation remains an explicit owner action |
| [ADR-0046](./0046-adopt-owner-local-business-surface-and-generated-ergonomics.md) | Current amendment | Concrete surface, explicit actions, owner facts, and structural tooling boundary |
| [ADR-0047](./0047-define-procurement-goods-receipt-boundary.md) | Current amendment | Procurement evidence plus Inventory movement in one bounded receipt transaction |
| [ADR-0056](./0056-adopt-ritsei-semantic-frontend-design-system.md) | Superseded frontend amendment | Product Patterns, Visual Grammar, and constrained Panda styling boundaries; Ark UI selection superseded |
| [ADR-0057](./0057-define-layered-tanstack-frontend-engine-boundaries.md) | Current frontend clarification | Selective Query cache plus headless Table, Virtual, Form, and optional Pacer/DB boundaries |
| [ADR-0072](./0072-prefer-native-solid-reactivity-for-effect-integration.md) | Current frontend integration boundary | Native Solid graph/context for Effect by default; Atom remains opt-in for shared or portable reactive graphs |
| [ADR-0069](./0069-adopt-cartographic-enterprise-visual-grammar.md) | Current frontend visual grammar | Cartographic Enterprise UI, HTML-first rendering, optional WebGPU, and governed material tokens |
| [ADR-0070](./0070-select-vgpu-and-defer-typegpu.md) | Current cartographic renderer selection | `vgpu` behind a RITSEI adapter; TypeGPU deferred for measured GPU-compute workloads |
| [ADR-0071](./0071-adopt-universal-cartographic-archetypes.md) | Current cartographic semantic model | Seven universal archetypes, context-aware mappings, deterministic variation, and semantic depth |
| [ADR-0058](./0058-define-provider-neutral-identity-and-authentication-boundary.md) | Current identity boundary | OIDC/OAuth2 provider-neutral contract; ZITADEL recommended; RITSEI owns account mapping, membership, and ERP authority |
| [ADR-0059](./0059-define-replaceable-relationship-authorization-engine.md) | Current authorization boundary | Native PostgreSQL RelationshipEngine default; SpiceDB optional; RITSEI/PostgreSQL remains canonical |
| [ADR-0064](./0064-propose-gcp-financial-staging-platform.md) | Proposed infrastructure selection | GCP is proposed for financial staging; provider approval and production-equivalent evidence remain open |
| [ADR-0065](./0065-propose-cloudflare-financial-edge-evidence-plane.md) | Proposed adjacent edge/evidence plane | Cloudflare may provide edge protection and a hash-bound evidence copy; it is not financial authority |
| [ADR-0067](./0067-separate-logical-database-and-physical-data-placement.md) | Current PostgreSQL topology boundary | Logical database contract hides physical placement; sharding and routing remain evidence-gated |
| [ADR-0068](./0068-establish-foundation-modules-platform-runtime-taxonomy.md) | Current repository taxonomy | Foundation, modules, platform, and runtime have explicit dependency direction |
| [ADR-0073](./0073-simplify-repository-enforcement-tooling.md) | Current enforcement tooling | Fallow and ast-grep own generic checks; one architecture checker owns path-sensitive boundaries |
| [ADR-0074](./0074-switch-to-kobalte-for-solid2-accessible-primitives.md) | Current frontend primitive selection | Kobalte 2.0 alpha behind RITSEI-owned UI contracts; native HTML remains the default and fallback |
| [ADR-0075](./0075-partition-dependency-ownership-by-application-boundary.md) | Current dependency ownership | Repository-wide dependencies stay at root; web-only dependencies and exact pins belong to `apps/web/package.json` |
| [ADR-0076](./0076-adopt-ritsei-typography-system.md) | Current typography direction | Pretendard is the product UI workhorse; IBM Plex Mono is semantic technical typography; Söhne is future brand/display only |
| [ADR-0077](./0077-adopt-ritsei-iconography-system.md) | Current iconography direction | Semantic icon API and registry; Phosphor is current, Nucleo UI is future, and cartographic identity remains the brand layer |
| [ADR-0078](./0078-adopt-ritsei-motion-system.md) | Current motion direction | PandaCSS owns CSS motion; Motion owns runtime geometry through a RITSEI wrapper; Solid owns state and Kobalte owns accessibility |
| [ADR-0079](./0079-gate-dnd-kit-solid2-activation.md) | Current drag/drop direction | dnd-kit Solid is the target provider, but activation is blocked by the Solid 2 `solid-js/web` export incompatibility; no shim or legacy React package |
| [ADR-0080](./0080-adopt-solid-native-boneyard-skeleton-boundary.md) | Current skeleton direction | Solid owns skeleton state and lifecycle; Boneyard supplies immutable geometry artifacts behind a RITSEI-owned adapter |
| [ADR-0081](./0081-adopt-document-ast-rendering-platform.md) | Proposed document-rendering direction | Owner-local snapshots feed a renderer-independent Document AST; native transactional rendering is the default candidate, while HTML/browser paths remain capability-gated |
| [ADR-0082](./0082-adopt-communication-platform-boundaries.md) | Current communication boundary | Domains publish facts or communication intents; recipient/context/template resolution, immutable artifacts, delivery attempts, and provider adapters remain separate, while Activity Timeline is a rebuildable projection |
| [ADR-0083](./0083-enforce-non-interference-between-source-of-truth-and-derived-capabilities.md) | Current cross-cutting non-interference boundary | Source-of-truth critical paths remain independent of derived capabilities; ADR-0034 owns detailed workload/resource proof |
| [ADR-0084](./0084-establish-explicit-progressive-trust-boundaries.md) | Proposed cross-cutting trust boundary | External representations gain no RITSEI identity, authority, or business fact until explicit runtime, identity, authorization, and owner-domain checks complete |
| [ADR-0085](./0085-separate-tanstack-adapters-from-semantic-ui-contracts.md) | Current frontend public-contract refinement | TanStack adapters are internal policy modules; semantic UI such as `DataTable`, `Form`, and business fields are the public feature boundary |
| [ADR-0086](./0086-promote-solid-effect-bridge-to-production-boundary.md) | Current Solid 2 × Effect implementation boundary | The shared production bridge is canonical; the experiment re-exports it as runnable evidence |

## Proposed direction

ADR-0081 is intentionally not included in the active canonical rules below. Until its validation gates
pass, it is a proposed platform boundary: no renderer dependency, generic document authority, or
production rendering route is activated. ADR-0082 is active as a boundary decision, but its production
provider, persistence, worker, and campaign activation gates remain open. ADR-0084 remains proposed;
its progressive trust model does not replace the existing active subsystem rules until accepted.

## Current canonical rules

The current architecture is summarized here for navigation; the canonical rule remains in
[`architecture-spec-v4.md`](../architecture/architecture-spec-v4.md) and the owning ADRs.

- Business objects and documents are owner-local.
- Ordinary structural changes may be CRUD-like only within owner-approved fields and policy.
- Meaningful business transitions use explicit, typed, authorized actions.
- Cross-domain consequences use public contracts and approved transaction protocols.
- Movement, posting, settlement, and other facts remain owned by their semantic capabilities.
- Generated schemas, DTOs, queries, forms, CRUD helpers, and test skeletons are tooling, not business authority.
- Persistence models, ORM hooks, provider types, and private repositories do not become public domain contracts.
- External standards remain behind versioned adapters.
- The selected IdentityProvider authenticates principals; it does not grant ERP authority.
- ZITADEL is the recommended IdentityProvider adapter, not a required dependency.
- RITSEI Authorization owns capability, scope, relationship coordination, SoD, and decision evidence.
- Native PostgreSQL is the default RelationshipEngine; SpiceDB is an optional adapter, not a source of truth.
- Goods Receipt evidence belongs to Procurement; physical receipt movement belongs to Inventory.
- The logical database contract hides PostgreSQL placement; physical data topology remains infrastructure, not domain semantics.
- Foundation contains generic contracts, modules contain business capabilities, platform contains concrete adapters, and runtime contains composition roots.
- Communication is intent-driven and provider-independent; email is a channel, delivery attempts are not business facts, and Activity Timeline is a rebuildable projection over separate owners.
- Class A source-of-truth reads and writes do not synchronously depend on unrelated Class B operational or Class C UX/analytical capabilities; committed facts and outbox records precede derived work.
- Solid owns the default frontend reactive graph and ownership tree; Effect `R` is carried by scoped Solid Context runtimes, while Atom is an explicit shared/portable opt-in.
- Cartographic is a grammar for structure, relationship, pressure, movement, boundary, and state—not a requirement for topographic maps on every page.
- The seven visual archetypes are Stock, Flow, Capacity, Value, Relationship, Progress, and Asset / Space; industries compose them rather than receiving separate visual themes.
- Material variation is deterministic and context-aware; semantic depth complements, but never replaces, semantic HTML, labels, contrast, or accessible alternatives.
- Typography uses a small 12–32px scale, 400/500/600 weights, tabular numerals, and semantic text styles rather than arbitrary component values.
- Iconography uses semantic names, Regular/Fill/Duotone variants, controlled 14–32px sizes, and a replaceable provider adapter.
- Motion is PandaCSS-first, runtime-only for geometry or physics, reduced-motion aware, and never a source of business truth.
- dnd-kit is the target direct-manipulation provider, but remains not activated until a Solid 2-compatible build and browser gate pass.
- Skeleton visibility and lifecycle remain Solid-owned; Boneyard is a static geometry/artifact provider and never a reactive or service owner.

## Historical integrity

Do not rewrite an accepted ADR to make it describe the current state. When the direction changes,
create a new ADR, state whether it amends or supersedes earlier decisions, update the canonical
architecture, and update this map. Historical ADR text remains the record of the earlier decision.
