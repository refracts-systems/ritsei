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
accessible-primitive selection; ADR-0074 supersedes only that selection in ADR-0056.
See the canonical design system for the boundaries that continue to apply. ADR-0075 is the current dependency-ownership boundary for workspace members.
ADR-0076 is the current typography direction and semantic text-style boundary.
ADR-0077 is the current semantic iconography and provider-adapter boundary.
ADR-0078 is the current motion ownership and runtime-wrapper boundary.
ADR-0079 is the current dnd-kit/Solid 2 activation gate and blocked-state boundary.
ADR-0080 is the current Solid-native Boneyard skeleton boundary.
ADR-0113 removes the dnd-kit and Boneyard probes and pinned dependencies and the computed-style
visual contract test; ADR-0079 and ADR-0080 keep their provider targets and import rules.
ADR-0081 is a superseded document-rendering proposal; ADR-0091 resets that direction.
ADR-0082 is the current SAP-separated Communication Platform and Activity Timeline projection boundary.
ADR-0084 is a superseded progressive-trust proposal, replaced by ADR-0091.
ADR-0085 is the current frontend public-contract refinement: TanStack adapters stay internal and semantic UI stays public. ADR-0086 is the current production implementation boundary for the native Solid 2 × Effect bridge.

## Selected decision lineage

The lineage includes historical decisions for context. Archived decisions do not establish a current
rule on their own; consult the linked successors and canonical architecture for their present scope.

```text
ADR-0015  One semantic owner per invariant
    |
    +--> ADR-0036  Owner-local documents and bounded financial baseline
              |
              +--> ADR-0081  Historical Document AST proposal (superseded by ADR-0091)
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
              +--> ADR-0087 replaces Deno resolution with Node.js and pnpm

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
              +--> ADR-0069 historical cartographic visual grammar (superseded by ADR-0090)
                        +--> HTML owns semantics and interaction
                        +--> WebGPU is optional and fallback-first
                        +--> material ratios are art direction, not a page template
                        +--> ADR-0070 selected vgpu (superseded by ADR-0091)
                                  +--> TypeGPU is deferred for future GPU-compute workloads
                        +--> ADR-0071 adopted seven universal archetypes (superseded by ADR-0090)
                                  +--> deterministic variation and semantic depth
              |
              +--> ADR-0090 Operational Clarity visual language
                        +--> neutral surfaces, one cobalt accent, status color only for status
                        +--> light icon navigation, 48px topbar, compact density
                        +--> ADR-0112 softens it: untinted neutrals, ink commands, an inset
                             workspace sheet, 14px text, and motion by frequency of use
                        +--> ADR-0091 later supersedes the vgpu selection

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
              +--> ADR-0091 withdraws the optional SpiceDB adapter
              +--> RITSEI/PostgreSQL remains canonical AuthZ authority
              +--> permission matrix remains the coarse gate
              +--> domain policy and SoD remain outside the engine

ADR-0024 / ADR-0058 / ADR-0059 / ADR-0063
    |
    +--> ADR-0084  Historical progressive trust proposal (superseded by ADR-0091)
              +--> external representations gain no RITSEI identity, authority, or business fact by default
              +--> runtime decoding, identity, authorization, domain, and resource boundaries remain explicit
              +--> intent and commands cannot bypass owner-controlled deterministic execution

ADR-0034  Historical overload isolation decision (superseded by ADR-0091)
    |
    +--> ADR-0083 historical non-interference decision (superseded by ADR-0091)
              +--> Class A source-of-truth paths do not depend on unrelated Class B/C capabilities
              +--> committed facts and outbox records precede derived work
              +--> derived failures, retries, resources, and rebuilds remain local
              +--> ADR-0093 retains workload isolation as an inactive target design
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

ADR-0046 and ADR-0047 refine the owner-local document and procurement boundaries. ADR-0074
replaces only ADR-0056's accessible primitive selection; later frontend decisions refine its other
boundaries. ADR-0090 supersedes the cartographic product identity in ADR-0069 and ADR-0071, and
ADR-0112 amends the visual language and motion values. ADR-0091 supersedes ADR-0070 and the
Document AST proposal in ADR-0081. ADR-0091 also supersedes the older ledger, workload isolation,
runtime, and analytic-plane decisions; ADR-0092 and ADR-0093 retain their subjects as inactive target
designs. PostgreSQL remains the active financial authority. ADR-0087 replaces the Deno toolchain
portions of ADR-0050; ADR-0075 retains dependency ownership by application boundary.

## Relationship matrix

| Decision | Relation | Current role |
|---|---|---|
| [ADR-0015](./0015-one-semantic-owner-per-invariant.md) | Amended interpretation | One owner remains authoritative for each invariant |
| [ADR-0036](./0036-define-p2-document-and-financial-baseline.md) | Amended interpretation | Documents remain owner-local; unresolved financial families remain gated |
| [ADR-0040](./archive/0040-adopt-tigerbeetle-financial-ledger.md) | Superseded | ADR-0091 supersedes the decision; ADR-0092 retains TigerBeetle as an inactive target |
| [ADR-0044](./0044-define-procurement-purchase-order-baseline.md) | Compatible | Procurement owns Purchase Order identity and lifecycle |
| [ADR-0045](./0045-define-procurement-purchase-order-confirmation.md) | Compatible | Purchase Order confirmation remains an explicit owner action |
| [ADR-0046](./0046-adopt-owner-local-business-surface-and-generated-ergonomics.md) | Current amendment | Concrete surface, explicit actions, owner facts, and structural tooling boundary |
| [ADR-0047](./0047-define-procurement-goods-receipt-boundary.md) | Current amendment | Procurement evidence plus Inventory movement in one bounded receipt transaction |
| [ADR-0056](./0056-adopt-ritsei-semantic-frontend-design-system.md) | Accepted, partially superseded | ADR-0074 supersedes the primitive selection; consult the current design system for remaining boundaries |
| [ADR-0057](./0057-define-layered-tanstack-frontend-engine-boundaries.md) | Current frontend clarification | Selective Query cache plus headless Table, Virtual, Form, and optional Pacer/DB boundaries |
| [ADR-0072](./0072-prefer-native-solid-reactivity-for-effect-integration.md) | Current frontend integration boundary | Native Solid graph/context for Effect by default; Atom remains opt-in for shared or portable reactive graphs |
| [ADR-0069](./archive/0069-adopt-cartographic-enterprise-visual-grammar.md) | Superseded | ADR-0090 replaces the product visual identity |
| [ADR-0070](./archive/0070-select-vgpu-and-defer-typegpu.md) | Superseded | ADR-0091 replaces the renderer selection |
| [ADR-0071](./archive/0071-adopt-universal-cartographic-archetypes.md) | Superseded | ADR-0090 replaces the archetype vocabulary as product direction |
| [ADR-0058](./0058-define-provider-neutral-identity-and-authentication-boundary.md) | Current identity boundary | OIDC/OAuth2 provider-neutral contract; ZITADEL recommended; RITSEI owns account mapping, membership, and ERP authority |
| [ADR-0059](./0059-define-replaceable-relationship-authorization-engine.md) | Amended authorization boundary | ADR-0091 keeps the native PostgreSQL relationship engine and withdraws the SpiceDB option |
| [ADR-0064](./archive/0064-propose-gcp-financial-staging-platform.md) | Superseded | ADR-0091 replaces the staging platform proposal |
| [ADR-0065](./archive/0065-propose-cloudflare-financial-edge-evidence-plane.md) | Superseded | ADR-0091 replaces the edge and evidence plane proposal |
| [ADR-0067](./0067-separate-logical-database-and-physical-data-placement.md) | Current PostgreSQL topology boundary | Logical database contract hides physical placement; sharding and routing remain evidence-gated |
| [ADR-0068](./0068-establish-foundation-modules-platform-runtime-taxonomy.md) | Current repository taxonomy | Foundation, modules, platform, and runtime have explicit dependency direction |
| [ADR-0073](./0073-simplify-repository-enforcement-tooling.md) | Current enforcement tooling | Fallow and ast-grep own generic checks; one architecture checker owns path-sensitive boundaries |
| [ADR-0074](./0074-switch-to-kobalte-for-solid2-accessible-primitives.md) | Current frontend primitive selection | Kobalte 2.0 alpha behind RITSEI-owned UI contracts; native HTML remains the default and fallback |
| [ADR-0075](./0075-partition-dependency-ownership-by-application-boundary.md) | Current dependency ownership | Repository-wide dependencies stay at root; web-only dependencies and exact pins belong to `apps/web/package.json` |
| [ADR-0076](./0076-adopt-ritsei-typography-system.md) | Current typography direction | Pretendard is the product UI workhorse; IBM Plex Mono is semantic technical typography; Söhne is future brand/display only |
| [ADR-0077](./0077-adopt-ritsei-iconography-system.md) | Current iconography direction | Semantic icon API and registry; ADR-0090 amends the global-navigation treatment |
| [ADR-0078](./0078-adopt-ritsei-motion-system.md) | Current motion direction | PandaCSS owns CSS motion; Motion owns runtime geometry through a RITSEI wrapper; Solid owns state and Kobalte owns accessibility |
| [ADR-0079](./0079-gate-dnd-kit-solid2-activation.md) | Current drag/drop direction | dnd-kit Solid is the target provider, but activation is blocked by the Solid 2 `solid-js/web` export incompatibility; no shim or legacy React package |
| [ADR-0080](./0080-adopt-solid-native-boneyard-skeleton-boundary.md) | Current skeleton direction | Solid owns skeleton state and lifecycle; ADR-0113 removes the Boneyard probe and pinned dependency |
| [ADR-0113](./0113-retire-frontend-compatibility-probes-and-visual-contract-test.md) | Current frontend evidence boundary | dnd-kit and Boneyard are targets that are not installed; Kobalte evidence is the wrapper tests in the application; there is no visual regression baseline |
| [ADR-0081](./archive/0081-adopt-document-ast-rendering-platform.md) | Superseded | ADR-0091 replaces the Document AST platform proposal |
| [ADR-0082](./0082-adopt-communication-platform-boundaries.md) | Current communication boundary | Domains publish facts or communication intents; recipient/context/template resolution, immutable artifacts, delivery attempts, and provider adapters remain separate, while Activity Timeline is a rebuildable projection |
| [ADR-0083](./archive/0083-enforce-non-interference-between-source-of-truth-and-derived-capabilities.md) | Superseded | ADR-0091 replaces the decision; ADR-0093 retains workload isolation as an inactive target |
| [ADR-0084](./archive/0084-establish-explicit-progressive-trust-boundaries.md) | Superseded | ADR-0091 replaces the progressive-trust proposal |
| [ADR-0085](./0085-separate-tanstack-adapters-from-semantic-ui-contracts.md) | Current frontend public-contract refinement | TanStack adapters are internal policy modules; semantic UI such as `DataTable`, `Form`, and business fields are the public feature boundary |
| [ADR-0086](./0086-promote-solid-effect-bridge-to-production-boundary.md) | Current Solid 2 × Effect implementation boundary | The shared production bridge is canonical; the experiment re-exports it as runnable evidence |

## Inactive target designs

[ADR-0092](./0092-retain-tigerbeetle-as-designated-ledger-engine.md) retains TigerBeetle as a
future ledger engine; PostgreSQL remains the active financial authority.
[ADR-0093](./0093-retain-isolation-runtime-and-analytic-target-designs.md) retains workload
isolation, the Stateful Entity Runtime, and the analytic plane as inactive target designs. Neither
ADR activates these targets.

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
- Native PostgreSQL is the RelationshipEngine; ADR-0091 withdraws the SpiceDB option.
- Goods Receipt evidence belongs to Procurement; physical receipt movement belongs to Inventory.
- The logical database contract hides PostgreSQL placement; physical data topology remains infrastructure, not domain semantics.
- Foundation contains generic contracts, modules contain business capabilities, platform contains concrete adapters, and runtime contains composition roots.
- Communication is intent-driven and provider-independent; email is a channel, delivery attempts are not business facts, and Activity Timeline is a rebuildable projection over separate owners.
- Committed facts and outbox records precede asynchronous derived work. Workload isolation remains an inactive target design under ADR-0093.
- Solid owns the default frontend reactive graph and ownership tree; Effect `R` is carried by scoped Solid Context runtimes, while Atom is an explicit shared/portable opt-in.
- ADR-0090 defines the product visual direction, amended by ADR-0112; consult the design system for current values.
- Typography uses a small 12–32px scale, 400/500/600 weights, tabular numerals, and semantic text styles rather than arbitrary component values.
- Iconography uses semantic names, Regular/Fill/Duotone variants, controlled 14–32px sizes, and a replaceable provider adapter.
- Motion is PandaCSS-first, runtime-only for geometry or physics, reduced-motion aware, and never a source of business truth.
- dnd-kit is the target direct-manipulation provider, but remains not activated until a Solid 2-compatible build and browser gate pass.
- Skeleton visibility and lifecycle remain Solid-owned; ADR-0113 removes the Boneyard probe and pinned dependency.

## Historical integrity

Do not rewrite an accepted ADR to make it describe the current state. When the direction changes,
create a new ADR, state whether it amends or supersedes earlier decisions, update the canonical
architecture, and update this map. Historical ADR text remains the record of the earlier decision.
