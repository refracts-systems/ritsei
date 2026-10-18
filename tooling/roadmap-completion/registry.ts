import { requiredFinancialGateIds } from "../financial-gate.ts"

export type GateKind = "markers" | "domain" | "financial" | "composite"

export type GateRequirement = {
  readonly path: string
  readonly markers?: readonly string[]
}

export type GateCommand = {
  readonly args: readonly string[]
}

export type Gate = {
  readonly id: string
  readonly title: string
  readonly source: string
  readonly kind: GateKind
  readonly requirements?: readonly GateRequirement[]
  readonly commands?: readonly GateCommand[]
  readonly domain?: string
  readonly financialId?: string
  readonly dependencies?: readonly string[]
}

export type RoadmapTrack = {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly gateIds: readonly string[]
}

const marker = (path: string, ...markers: string[]): GateRequirement => ({ path, markers })
const file = (path: string): GateRequirement => ({ path })
const task = (...args: string[]): GateCommand => ({ args: ["task", ...args] })

export const financialGateIds = requiredFinancialGateIds

export const gates: readonly Gate[] = [
  {
    id: "erp.p0",
    title: "P0 scope and identity baseline",
    source: "docs/roadmap/erp-primitives.md",
    kind: "markers",
    commands: [
      task(
        "test",
        "modules/identity/tests/identity.test.ts",
        "modules/party/tests/party.test.ts",
      ),
    ],
    requirements: [
      marker(
        "docs/roadmap/erp-primitives.md",
        "**P0 baseline status: `READY`.",
        "All P0-01 through P0-10 tasks have public contracts and executable",
        "proof.",
        "P0-10",
      ),
      file("docs/decisions/0021-define-p0-scope-and-identity-model.md"),
      file("modules/identity/tests/identity.test.ts"),
      file("modules/party/tests/party.test.ts"),
    ],
  },
  {
    id: "erp.p0-migration",
    title: "P0 legacy cohort migration evidence",
    source: "docs/roadmap/erp-primitives.md",
    kind: "markers",
    dependencies: ["erp.p0"],
    commands: [task("test", "runtime/migrator/p0-backfill.test.ts")],
    requirements: [
      marker(
        "docs/roadmap/erp-primitives.md",
        "### P0 migration cohort gate",
        "operator-supplied mapping",
        "missing, duplicate, and unknown mappings",
      ),
      file("docs/decisions/0028-complete-p0-identity-party-and-branch-metadata.md"),
      file("docs/decisions/0029-rename-user-and-party-public-vocabulary.md"),
      marker(
        "runtime/migrator/p0-backfill.ts",
        "assertExactCoverage",
        "missing=",
        "unknown=",
        "duplicates=",
        "client.begin",
      ),
      marker(
        "runtime/migrator/p0-backfill.test.ts",
        "P0BackfillFailure",
        "missing=",
        "unknown=",
        "duplicates=",
      ),
    ],
  },
  {
    id: "erp.p1",
    title: "P1 product, quantity, and location baseline",
    source: "docs/roadmap/erp-primitives.md",
    kind: "markers",
    dependencies: ["erp.p0-migration"],
    commands: [task("test", "modules/inventory/tests/inventory.test.ts")],
    requirements: [
      marker(
        "docs/roadmap/erp-primitives.md",
        "### P1 — Product, Quantity, and Location",
        "The baseline is decided by",
        "quantity inputs and outputs have typed units",
      ),
      file("docs/decisions/0035-define-p1-inventory-primitives.md"),
      marker("modules/inventory/tests/inventory.test.ts", "adjustStock", "reserveStock"),
    ],
  },
  {
    id: "erp.p2",
    title: "P2 documents and financial semantics baseline",
    source: "docs/roadmap/erp-primitives.md",
    kind: "markers",
    dependencies: ["erp.p1"],
    commands: [task("test", "modules/accounting/tests/accounting.test.ts")],
    requirements: [
      marker(
        "docs/roadmap/erp-primitives.md",
        "### P2 — Documents and Financial Semantics",
        "The baseline is decided by",
        "document transitions have preconditions, effects, authorization, and retry behavior",
      ),
      file("docs/decisions/0036-define-p2-document-and-financial-baseline.md"),
      marker(
        "modules/accounting/tests/accounting.test.ts",
        "postRevenueForOrder",
        "reverseRevenue",
      ),
    ],
  },
  {
    id: "erp.p3",
    title: "P3 audit, events, and integration baseline",
    source: "docs/roadmap/erp-primitives.md",
    kind: "markers",
    dependencies: ["erp.p2"],
    commands: [task("test", "modules/catalog/tests/catalog.test.ts")],
    requirements: [
      marker(
        "docs/roadmap/erp-primitives.md",
        "**P3 baseline status: `READY` for the bounded PostgreSQL-internal baseline.",
        "committed facts publish typed versioned events atomically where required",
      ),
      file("docs/decisions/0037-define-p3-audit-event-and-delivery-boundary.md"),
      file("docs/decisions/0038-move-internal-event-delivery-to-messaging.md"),
      marker(
        "modules/catalog/tests/catalog.test.ts",
        "AccountingRevenuePostedEvent",
        "ProcurementPurchaseOrderConfirmedEvent",
      ),
    ],
  },
  {
    id: "domain.identity-lifecycle",
    title: "Identity lifecycle and membership revocation",
    source: "docs/roadmap/domain-maturity.md",
    kind: "markers",
    dependencies: ["erp.p0-migration"],
    commands: [
      task(
        "test",
        "modules/identity/tests/identity.test.ts",
        "modules/identity/tests/identity.postgres.test.ts",
        "modules/authorization/tests/authorization.test.ts",
        "modules/authorization/tests/authorization.postgres.test.ts",
      ),
    ],
    requirements: [
      marker(
        "docs/roadmap/domain-maturity.md",
        "### D0.1 — Identity lifecycle",
        "disabled-account",
        "membership",
        "revocation",
      ),
      marker(
        "docs/architecture/identity-and-principals.md",
        "stale revocation or tenant mapping",
        "fail closed",
      ),
      marker(
        "modules/identity/tests/identity.test.ts",
        "disables and enables authentication state",
        "sessionInvalidatedAt",
      ),
      marker(
        "modules/identity/tests/identity.postgres.test.ts",
        "persists account disablement and session invalidation state in PostgreSQL",
      ),
      marker(
        "modules/authorization/tests/authorization.test.ts",
        "suspends tenant access without deleting the global account",
      ),
      file("docs/decisions/0030-user-account-lifecycle-and-tenant-membership.md"),
    ],
  },
  {
    id: "domain.authorization-foundation",
    title: "Authorization foundation and fail-closed policy",
    source: "docs/roadmap/domain-maturity.md",
    kind: "markers",
    dependencies: ["domain.identity-lifecycle"],
    commands: [
      task(
        "test",
        "modules/authorization/tests/authorization.test.ts",
        "modules/authorization/tests/authorization.postgres.test.ts",
        "modules/authorization/tests/capabilities.test.ts",
      ),
    ],
    requirements: [
      marker(
        "docs/roadmap/domain-maturity.md",
        "### D0.2 — Authorization foundation",
        "relationship/object checks",
        "Separation of Duties",
        "explainable denial",
      ),
      marker(
        "docs/architecture/authorization.md",
        "relationship/object evaluation",
        "Separation of Duties",
        "explainable decision evidence",
        "unknown relationship result",
      ),
      marker(
        "modules/authorization/tests/authorization.test.ts",
        "denies by default and on scope mismatch",
      ),
      file("modules/authorization/tests/relationship.postgres.test.ts"),
      file("modules/authorization/tests/sod.test.ts"),
      file("docs/decisions/0059-define-replaceable-relationship-authorization-engine.md"),
    ],
  },
  {
    id: "domain.capability-grammar",
    title: "Canonical capability grammar and migration",
    source: "docs/roadmap/domain-maturity.md",
    kind: "markers",
    dependencies: ["domain.authorization-foundation"],
    commands: [
      task(
        "test",
        "modules/authorization/tests/capabilities.test.ts",
        "modules/authorization/tests/capability-migration.postgres.test.ts",
      ),
    ],
    requirements: [
      marker(
        "docs/roadmap/domain-maturity.md",
        "### D0.3 — Capability grammar",
        "owner/resource/business-verb grammar",
      ),
      marker(
        "modules/authorization/src/capabilities.ts",
        "CapabilityIds",
        "forbiddenVerbs",
        "isCapabilityIdShape",
      ),
      marker(
        "modules/authorization/tests/capabilities.test.ts",
        "accepts canonical shapes and rejects broad or nested names",
        "legacy identifiers outside the assignable capability schema",
      ),
      file("docs/decisions/0031-capability-naming-and-business-verb-conventions.md"),
    ],
  },
  ...[
    "identity",
    "party",
    "inventory",
    "accounting",
    "sales",
    "procurement",
  ].map((domain) => ({
    id: `domain.${domain}.level3`,
    title: `${domain} bounded Level 3 provider slice`,
    source: "tooling/domain-maturity/measure.ts",
    kind: "domain" as const,
    domain,
    dependencies: ["domain.capability-grammar"],
  })),
  ...financialGateIds.map((financialId) => ({
    id: `financial.${financialId}`,
    title: `Financial readiness: ${financialId}`,
    source: "tooling/financial-gate.ts",
    kind: "financial" as const,
    financialId,
  })),
  {
    id: "process.pre08",
    title: "Process Studio pre-0.8 prerequisites",
    source: "docs/roadmap/process-studio.md",
    kind: "markers",
    dependencies: [
      "erp.p0",
      "erp.p1",
      "erp.p2",
      "erp.p3",
      "domain.inventory.level3",
      "domain.sales.level3",
    ],
    commands: [task("test", "modules/process/tests/process.test.ts")],
    requirements: [
      marker(
        "docs/roadmap/process-studio.md",
        "## Pre-0.8 Gate",
        "[x] scope, organization, party, product, UOM, location, document, quantity, money,",
        "[x] procurement and billing ownership is clear for any purchase or payment process",
        "[x] at least two existing domains can expose stable public commands",
        "[x] event ownership and delivery semantics are explicit",
        "[x] compensation/manual recovery metadata has an owning-domain contract",
        "[x] catalog versioning and compatibility rules have an ADR or canonical rule",
        "[x] workflow authorization is separate from domain action authorization",
        "[x] durable engine compatibility gates remain enforced",
        "[x] external action/event profile is defined separately from domain actions/events",
        "[x] connector authentication, idempotency, delivery, and compensation rules are explicit",
        "[x] capability release states and compatibility ranges are defined",
        "[x] process promotion separates release from deployment across environments",
        "[x] execution principal, delegation, SoD, and business observability are explicit",
        "[x] authentication, current tenant membership, relationship scope, and revocation fail closed",
        "[x] AI output is non-authoritative; no AgentPrincipal, agent node, or autonomous mutation is in scope",
      ),
      marker(
        "docs/architecture/identity-and-principals.md",
        "tenant membership",
        "revocation",
        "fails closed",
      ),
      file("docs/decisions/0020-adopt-capability-release-and-runtime-governance.md"),
      file("docs/decisions/0060-defer-billing-and-settlement-scope.md"),
    ],
  },
  {
    id: "process.catalog08",
    title: "Process Studio 0.8 catalog aggregation and release gate",
    source: "docs/roadmap/process-studio.md",
    kind: "markers",
    dependencies: ["process.pre08"],
    commands: [task("test", "modules/process/tests/catalog-release.test.ts")],
    requirements: [
      marker(
        "modules/process/src/catalog-release.ts",
        "ProcessReleaseValidation",
        "resolveReleasedCapability",
        "unregistered capability",
      ),
      marker(
        "modules/process/tests/catalog-release.test.ts",
        "rejects unregistered actions",
        "released process",
        "catalog compatibility",
      ),
    ],
  },
  {
    id: "process.runtime085",
    title: "Process Studio 0.85 durable headless runtime",
    source: "docs/roadmap/process-studio.md",
    kind: "markers",
    dependencies: ["process.catalog08"],
    commands: [
      task(
        "test",
        "modules/process/tests/runtime.test.ts",
        "modules/process/tests/runtime-postgres.test.ts",
      ),
    ],
    requirements: [
      marker(
        "modules/process/src/runtime-store.ts",
        "ProcessCheckpointStore",
        "durable checkpoint",
        "recoverCheckpoint",
      ),
      marker(
        "modules/process/tests/runtime-postgres.test.ts",
        "crash recovery",
        "duplicate event",
        "exact catalog version",
        "restart",
      ),
    ],
  },
  {
    id: "process.fencing087",
    title: "Process Studio lease fencing boundary",
    source: "docs/roadmap/process-studio.md",
    kind: "markers",
    dependencies: ["process.runtime085"],
    commands: [task("test", "modules/process/tests/jobs.postgres.test.ts")],
    requirements: [
      marker(
        "docs/roadmap/process-studio.md",
        "### 0.87 — Lease fencing boundary",
        "shared fence scope",
        "stale-writer rejection",
        "idempotency identity remains separate",
      ),
      marker(
        "modules/process/src/postgres.ts",
        "fenceScope",
        "leaseGeneration",
        "ProcessJobLeaseLost",
        "eq(processJobs.leaseGeneration, decoded.leaseGeneration)",
      ),
      marker(
        "modules/process/tests/jobs.postgres.test.ts",
        "allocates distinct generations for concurrent claims in one fence scope",
        "staleCompletion",
        "ProcessJobLeaseLost",
      ),
      file("docs/decisions/0052-separate-lease-capability-and-fencing-generation.md"),
      file("docs/decisions/0054-keep-fencing-and-idempotency-identities-orthogonal.md"),
      file("docs/decisions/0055-use-explicit-fence-scopes-for-shared-job-streams.md"),
    ],
  },
  {
    id: "process.ops09",
    title: "Process Studio 0.9 operational maturity",
    source: "docs/roadmap/process-studio.md",
    kind: "markers",
    dependencies: ["process.fencing087"],
    commands: [
      task(
        "test",
        "modules/process/tests/operations.test.ts",
        "modules/process/tests/operations-postgres.test.ts",
      ),
    ],
    requirements: [
      marker(
        "modules/process/src/operations-store.ts",
        "ProcessOperatorStore",
        "manual recovery",
        "compensation",
        "authorized operator",
      ),
      marker(
        "modules/process/tests/operations-postgres.test.ts",
        "unknown external outcome",
        "operator control",
        "crash recovery",
      ),
    ],
  },
  {
    id: "process.designer095",
    title: "Process Studio 0.95 validated designer",
    source: "docs/roadmap/process-studio.md",
    kind: "markers",
    dependencies: ["process.ops09"],
    commands: [
      task(
        "test",
        "apps/web/src/features/process-studio/designer.test.ts",
        "apps/web/src/features/process-studio/product-surface.test.ts",
      ),
    ],
    requirements: [
      marker(
        "apps/web/src/features/process-studio/designer-model.ts",
        "process designer",
        "typed mapping",
        "deterministic Process IR",
      ),
      marker(
        "apps/web/src/features/process-studio/designer.test.ts",
        "keyboard",
        "deterministic Process IR",
      ),
    ],
  },
  {
    id: "process.governed10",
    title: "Process Studio 1.0 governed release",
    source: "docs/roadmap/process-studio.md",
    kind: "markers",
    dependencies: ["process.designer095"],
    commands: [task("test", "modules/process/tests/release-postgres.test.ts")],
    requirements: [
      marker(
        "modules/process/src/release-store.ts",
        "immutable release",
        "deployment binding",
        "approval",
        "audit",
      ),
      marker(
        "modules/process/tests/release-postgres.test.ts",
        "release immutability",
        "promotion audit",
        "environment",
      ),
    ],
  },
  {
    id: "integration.contract08",
    title: "External integration 0.8 contract profile",
    source: "docs/roadmap/integration-surface.md",
    kind: "markers",
    dependencies: ["process.pre08"],
    commands: [
      task(
        "test",
        "modules/integrations/tests/openapi.test.ts",
        "modules/integrations/tests/cloudevents.test.ts",
      ),
    ],
    requirements: [
      marker(
        "modules/integrations/src/openapi.ts",
        "OpenAPI 3.2.0",
        "allowlist",
        "ExternalAction",
      ),
      marker(
        "modules/integrations/src/cloudevents.ts",
        "CloudEvents 1.0.x",
        "ExternalEvent",
        "separate envelope",
      ),
      marker(
        "modules/integrations/tests/openapi.test.ts",
        "allowlisted operation",
        "provider credentials",
      ),
    ],
  },
  {
    id: "integration.runtime085",
    title: "External integration 0.85 connector runtime",
    source: "docs/roadmap/integration-surface.md",
    kind: "markers",
    dependencies: ["integration.contract08"],
    commands: [task("test", "modules/integrations/tests/https-runtime.test.ts")],
    requirements: [
      marker(
        "modules/integrations/src/https-runtime.ts",
        "HTTPS",
        "verify signature",
        "WebhookIngestion",
        "deduplicate",
      ),
      marker(
        "modules/integrations/src/delivery-store.ts",
        "delivery log",
        "unknown outcome",
        "manual recovery",
      ),
      marker(
        "modules/integrations/tests/https-runtime.test.ts",
        "duplicate delivery",
        "timeout",
        "unknown outcome",
      ),
    ],
  },
  {
    id: "integration.reliability09",
    title: "External integration 0.9 reliability and compatibility",
    source: "docs/roadmap/integration-surface.md",
    kind: "markers",
    dependencies: ["integration.runtime085"],
    commands: [
      task(
        "test",
        "modules/integrations/tests/reliability.test.ts",
        "modules/integrations/tests/reliability-postgres.test.ts",
      ),
    ],
    requirements: [
      marker(
        "modules/integrations/src/reliability-store.ts",
        "dead letter",
        "replay protection",
        "provider status",
        "redaction",
      ),
      marker(
        "modules/integrations/tests/reliability-postgres.test.ts",
        "compatibility",
        "payload limit",
        "health metric",
      ),
    ],
  },
  {
    id: "integration.process095",
    title: "External integration 0.95 Process Studio integration",
    source: "docs/roadmap/integration-surface.md",
    kind: "markers",
    dependencies: ["integration.reliability09"],
    commands: [task("test", "modules/integrations/tests/process-bridge.test.ts")],
    requirements: [
      marker(
        "modules/integrations/src/process-bridge.ts",
        "ExternalCatalogEntry",
        "simulateWithoutSideEffect",
        "transport absent from Process IR",
      ),
      marker(
        "modules/integrations/tests/process-bridge.test.ts",
        "separate OAuth scope",
        "typed mapping",
        "no provider side effect",
      ),
    ],
  },
  {
    id: "integration.governed10",
    title: "External integration 1.0 governed surface",
    source: "docs/roadmap/integration-surface.md",
    kind: "markers",
    dependencies: ["integration.process095"],
    commands: [
      task(
        "test",
        "modules/integrations/tests/governance.test.ts",
        "modules/integrations/tests/governance-postgres.test.ts",
      ),
    ],
    requirements: [
      marker(
        "modules/integrations/src/governance-store.ts",
        "reviewed connector",
        "connector retirement",
        "delivery controls",
        "audit",
      ),
      marker(
        "modules/integrations/tests/governance-postgres.test.ts",
        "unreviewed operation",
        "connector version",
        "retention",
      ),
    ],
  },
  {
    id: "packs.contract",
    title: "Business Pack contract slice",
    source: "docs/roadmap/process-pack-library.md",
    kind: "markers",
    dependencies: ["process.pre08"],
    commands: [task("test", "modules/process/tests/packs.test.ts")],
    requirements: [
      marker(
        "docs/roadmap/process-pack-library.md",
        "**Track ID:** `packs`",
        "## Measures",
        "## Stop conditions",
      ),
      marker(
        "modules/process/tests/packs.test.ts",
        "Distribution starter pack",
        "missing_required_capabilities",
      ),
    ],
  },
  {
    id: "postgres19.minimum-version",
    title: "PostgreSQL 19 minimum version enforcement",
    source: "docs/roadmap/postgresql-19.md",
    kind: "markers",
    commands: [task("test", "platform/postgres/tests/database.test.ts")],
    requirements: [
      marker(
        "platform/postgres/postgres.ts",
        "server_version_num",
        "version < 190000",
        "UnsupportedPostgresVersion",
      ),
      marker(
        "platform/postgres/tests/database.test.ts",
        "rejects PostgreSQL versions below 19",
        "UnsupportedPostgresVersion",
      ),
      file("docs/roadmap/postgresql-19.md"),
    ],
  },
  {
    id: "postgres19.wait-for-pilot",
    title: "PostgreSQL 19 route-scoped WAIT FOR pilot",
    source: "docs/roadmap/postgresql-19.md",
    kind: "markers",
    dependencies: ["postgres19.minimum-version"],
    commands: [
      task(
        "test",
        "platform/postgres/tests/database.test.ts",
        "runtime/api/handlers.test.ts",
        "runtime/api/procurement.integration.test.ts",
      ),
    ],
    requirements: [
      marker(
        "foundation/database/consistency.ts",
        "ConsistencyToken",
        "tenant_mismatch",
        "timeline_mismatch",
      ),
      marker(
        "platform/postgres/consistency.ts",
        "pg_current_wal_insert_lsn",
        "WAIT FOR LSN",
        "standby_replay",
        "NO_THROW",
      ),
      marker(
        "runtime/api/handlers.ts",
        "x-ritsei-consistency-token",
        "PostgresReadYourWrites",
        "createPurchaseOrder",
        "getPurchaseOrder",
      ),
      marker(
        "platform/postgres/tests/database.test.ts",
        "captures and waits for an opaque PostgreSQL consistency token",
        "rejects promotion and timeline mismatches",
        "maps bounded replica wait timeouts",
      ),
      marker(
        "platform/postgres/tests/postgresql-19.postgres.test.ts",
        "proves non-superuser PostgreSQL 19 control and WAIT FOR privileges",
      ),
    ],
  },
  {
    id: "postgres19.property-graph-pilot",
    title: "PostgreSQL 19 Party read-projection pilot",
    source: "docs/roadmap/postgresql-19.md",
    kind: "markers",
    dependencies: ["postgres19.minimum-version"],
    commands: [
      task(
        "test",
        "modules/party/tests/party.test.ts",
        "tests/architecture/postgresql-19.test.ts",
      ),
    ],
    requirements: [
      marker(
        "db/migrations/20260831124952_add_party_property_graph/migration.sql",
        "CREATE VIEW",
        "party_relationships",
        "legal_entity_organization_edges",
        "\"relationship\".\"active\"",
      ),
      marker(
        "modules/party/src/contract.ts",
        "RelatedPartyPath",
        "FindRelatedPartyPathsInput",
      ),
      marker(
        "modules/party/src/postgres.ts",
        "party.related-party-paths.find",
        "relatedPartyPaths",
      ),
      marker(
        "modules/party/tests/party.postgres.test.ts",
        "findRelatedPartyPaths",
        "baseline",
        "targetPartyId",
        "explain (analyze, buffers, format json)",
        "Execution Time",
        "Limit",
      ),
    ],
  },
  {
    id: "postgres19.repack-rehearsal",
    title: "PostgreSQL 19 REPACK and operations rehearsal",
    source: "docs/roadmap/postgresql-19.md",
    kind: "markers",
    dependencies: ["postgres19.minimum-version"],
    commands: [task("test", "tests/architecture/postgresql-19.test.ts")],
    requirements: [
      marker(
        "tooling/postgresql-19/rehearse.ts",
        "REPACK (CONCURRENTLY true, ANALYZE true)",
        "pg_stat_io",
        "data_checksums",
        "reserved_connections",
      ),
      marker(
        "docs/operations/postgresql-19.md",
        "RITSEI_DISPOSABLE_DATABASE_URL",
        "production-eligible",
        "not eligible",
      ),
      file("docs/operations/postgresql-19-evidence-2026-08-31.json"),
      marker(
        "docs/operations/postgresql-19-evidence-2026-08-31.json",
        "\"productionEligible\": false",
        "\"indexValidAfter\": true",
        "\"checksum\":",
      ),
    ],
  },
  {
    id: "postgres19.production-ga",
    title: "PostgreSQL 19 production GA activation",
    source: "docs/roadmap/postgresql-19.md",
    kind: "markers",
    dependencies: [
      "postgres19.wait-for-pilot",
      "postgres19.property-graph-pilot",
      "postgres19.repack-rehearsal",
    ],
    requirements: [
      file("docs/operations/postgresql-19-production-evidence.json"),
      marker(
        "docs/roadmap/postgresql-19.md",
        "production review explicitly approves activation",
        "PostgreSQL 19 GA",
      ),
    ],
  },
  {
    id: "workload.classify",
    title: "Workload classification and boundary baseline",
    source: "docs/roadmap/workload.md",
    kind: "markers",
    dependencies: ["process.pre08", "postgres19.minimum-version"],
    commands: [task("test", "tests/architecture/roadmap-track-contracts.test.ts")],
    requirements: [
      marker(
        "docs/roadmap/workload.md",
        "### W0 — Workload classification",
        "runtime/workload/classification.ts",
        "command, query, and async metadata",
      ),
      marker(
        "docs/architecture/workload-isolation.md",
        "workload class",
        "command_reserved > 0",
        "adaptive_limit <= hard_limit",
      ),
      file("runtime/workload/classification.ts"),
      file("tests/workload/classification.test.ts"),
      marker(
        "tests/architecture/roadmap-track-contracts.test.ts",
        "keeps workload classification separate from authorization and business authority",
      ),
    ],
  },
  {
    id: "workload.command-reserve",
    title: "Protected command reserve and non-interference proof",
    source: "docs/roadmap/workload.md",
    kind: "markers",
    dependencies: ["workload.classify"],
    commands: [task("test", "tests/architecture/roadmap-track-contracts.test.ts")],
    requirements: [
      marker(
        "docs/roadmap/workload.md",
        "### W1 — Protected command reserve",
        "non-zero reviewed reserve",
        "query and async work cannot acquire",
      ),
      marker(
        "docs/architecture/workload-isolation.md",
        "command_reserved > 0",
        "projection failure or saturation never changes routing to the primary",
        "fall back from query to command resources.",
      ),
      file("runtime/workload/admission.ts"),
      file("tests/workload/non-interference.test.ts"),
      file("docs/operations/workload-isolation-evidence.json"),
      marker(
        "tests/architecture/roadmap-track-contracts.test.ts",
        "keeps workload classification separate from authorization and business authority",
      ),
    ],
  },
  {
    id: "frontend.shell",
    title: "Frontend application shell",
    source: "docs/roadmap/frontend.md",
    kind: "markers",
    dependencies: ["workload.command-reserve", "process.designer095"],
    commands: [
      task(
        "test",
        "tests/frontend/shell.test.ts",
        "tests/architecture/roadmap-track-contracts.test.ts",
        "apps/web/src/features/process-studio/designer.test.ts",
      ),
    ],
    requirements: [
      marker(
        "docs/roadmap/frontend.md",
        "### F0 — Application shell",
        "reproducible Vite/SolidJS 2.0 SPA",
        "apps/web/vite.config.ts",
      ),
      marker(
        "docs/architecture/frontend.md",
        "Vite",
        "SolidJS 2.0 SPA",
        "The browser must not connect directly to PostgreSQL",
      ),
      file("apps/web/package.json"),
      file("apps/web/index.html"),
      file("apps/web/vite.config.ts"),
      file("apps/web/src/app"),
      marker(
        "tests/architecture/roadmap-track-contracts.test.ts",
        "keeps the frontend as a typed, separately deployed SPA",
      ),
    ],
  },
  {
    id: "frontend.application-boundaries",
    title: "Frontend application and remote-state boundaries",
    source: "docs/roadmap/frontend.md",
    kind: "markers",
    dependencies: ["frontend.shell"],
    commands: [
      task(
        "test",
        "tests/frontend/workflow.test.ts",
        "tests/architecture/roadmap-track-contracts.test.ts",
        "apps/web/src/features/process-studio/designer.test.ts",
      ),
    ],
    requirements: [
      marker(
        "docs/roadmap/frontend.md",
        "### F1 — Application boundaries",
        "TanStack Solid Query",
        "authoritative query results",
      ),
      marker(
        "docs/architecture/frontend.md",
        "TanStack Solid Query owns cache policy",
        "Effect Schema",
        "The route layer should only",
      ),
      file("apps/web/src/app"),
      file("apps/web/src/shared"),
    ],
  },
  {
    id: "frontend.design-system",
    title: "RITSEI frontend design-system activation",
    source: "docs/roadmap/frontend.md",
    kind: "markers",
    dependencies: ["frontend.shell"],
    commands: [
      task(
        "test",
        "apps/web/src/ui/accessibility.test.ts",
        "tests/frontend/kobalte.test.ts",
        "tests/architecture/roadmap-track-contracts.test.ts",
      ),
    ],
    requirements: [
      marker(
        "docs/roadmap/frontend.md",
        "### F2 — RITSEI design system",
        "RITSEI-owned UI wrappers",
        "Product Patterns",
      ),
      marker(
        "docs/architecture/design-system.md",
        "Kobalte",
        "Panda CSS",
        "Contrast checks are activation evidence",
      ),
      file("apps/web/src/ui"),
      file("docs/operations/frontend-design-system-evidence.json"),
      marker(
        "tests/architecture/roadmap-track-contracts.test.ts",
        "keeps the frontend as a typed, separately deployed SPA",
      ),
    ],
  },
  {
    id: "frontend.accessibility-performance",
    title: "Frontend accessibility and performance evidence",
    source: "docs/roadmap/frontend.md",
    kind: "markers",
    dependencies: ["frontend.application-boundaries", "frontend.design-system"],
    commands: [
      task(
        "test",
        "apps/web/src/ui/accessibility.test.ts",
        "tests/architecture/roadmap-track-contracts.test.ts",
        "apps/web/src/features/process-studio/designer.test.ts",
      ),
    ],
    requirements: [
      marker(
        "docs/roadmap/frontend.md",
        "### F3 — Accessibility and performance",
        "keyboard and screen-reader behavior",
        "long-session stability",
      ),
      marker(
        "docs/architecture/frontend.md",
        "## Accessibility",
        "## Performance",
        "## Completion Criteria",
      ),
      file("apps/web/src/ui/accessibility.test.ts"),
      file("docs/operations/frontend-readiness-evidence.json"),
    ],
  },
  {
    id: "production.artifacts",
    title: "Reproducible release artifacts",
    source: "docs/roadmap/production.md",
    kind: "markers",
    dependencies: ["frontend.shell", "postgres19.minimum-version"],
    commands: [task("test", "tests/architecture/roadmap-track-contracts.test.ts")],
    requirements: [
      marker(
        "docs/roadmap/production.md",
        "### P0 — Reproducible artifacts",
        "deploy/artifacts/manifest.json",
        "source-only caveat",
      ),
      marker(
        "docs/development/releasing.md",
        "source-only snapshots",
        "build artifact",
        "supported upgrade path",
      ),
      file("deploy/artifacts/manifest.json"),
      file("docs/operations/release-artifact-evidence.json"),
      marker(
        "tests/architecture/roadmap-track-contracts.test.ts",
        "keeps production claims behind reviewed artifacts and profile approval",
      ),
    ],
  },
  {
    id: "production.install-upgrade",
    title: "Production install and upgrade rehearsal",
    source: "docs/roadmap/production.md",
    kind: "markers",
    dependencies: ["production.artifacts", "postgres19.production-ga"],
    commands: [task("test", "tests/architecture/roadmap-track-contracts.test.ts")],
    requirements: [
      marker(
        "docs/roadmap/production.md",
        "### P1 — Install and upgrade",
        "tooling/production/install-upgrade.ts",
        "forward recovery",
      ),
      marker(
        "docs/deployment/README.md",
        "PostgreSQL 19",
        "entry + postgresql",
      ),
      file("tooling/production/install-upgrade.ts"),
      file("docs/operations/production-install-upgrade-evidence.json"),
    ],
  },
  {
    id: "production.entry-profile",
    title: "Reviewed entry deployment profile",
    source: "docs/roadmap/production.md",
    kind: "markers",
    dependencies: ["production.install-upgrade"],
    commands: [task("test", "tests/architecture/roadmap-track-contracts.test.ts")],
    requirements: [
      marker(
        "docs/roadmap/production.md",
        "### P2 — Reviewed entry profile",
        "deploy/profiles/entry.json",
        "profile-evaluate",
      ),
      marker(
        "deploy/entry/README.md",
        "not production HA evidence",
        "RITSEI_FINANCIAL_AUTHORITY=postgresql",
      ),
      file("deploy/profiles/entry.json"),
      file("tooling/production/profile-evaluate.ts"),
      file("docs/operations/production-profile-evidence.json"),
    ],
  },
  {
    id: "roadmap.global-exit",
    title: "Global roadmap exit criteria",
    source: "docs/roadmap/README.md",
    kind: "composite",
    dependencies: [
      "erp.p0",
      "erp.p0-migration",
      "erp.p1",
      "erp.p2",
      "erp.p3",
      "domain.identity-lifecycle",
      "domain.authorization-foundation",
      "domain.capability-grammar",
      "domain.identity.level3",
      "domain.party.level3",
      "domain.inventory.level3",
      "domain.accounting.level3",
      "domain.sales.level3",
      "domain.procurement.level3",
      ...financialGateIds.map((id) => `financial.${id}`),
      "process.pre08",
      "process.catalog08",
      "process.runtime085",
      "process.fencing087",
      "process.ops09",
      "process.designer095",
      "process.governed10",
      "integration.contract08",
      "integration.runtime085",
      "integration.reliability09",
      "integration.process095",
      "integration.governed10",
      "packs.contract",
      "postgres19.minimum-version",
      "postgres19.wait-for-pilot",
      "postgres19.property-graph-pilot",
      "postgres19.repack-rehearsal",
      "postgres19.production-ga",
      "workload.classify",
      "workload.command-reserve",
      "frontend.shell",
      "frontend.application-boundaries",
      "frontend.design-system",
      "frontend.accessibility-performance",
      "production.artifacts",
      "production.install-upgrade",
      "production.entry-profile",
    ],
  },
]

export const gateIds = gates.map((gate) => gate.id)

export const validateGateGraph = (input: readonly Gate[]): string[] => {
  const ids = input.map((gate) => gate.id)
  const knownIds = new Set(ids)
  const failures = ids
    .filter((id, index) => ids.indexOf(id) !== index)
    .map((id) => `duplicate roadmap gate ID: ${id}`)

  for (const [index, gate] of input.entries()) {
    for (const dependency of gate.dependencies ?? []) {
      if (!knownIds.has(dependency)) {
        failures.push(`${gate.id} has unknown dependency ${dependency}`)
      } else if (dependency === gate.id) {
        failures.push(`${gate.id} cannot depend on itself`)
      } else if (ids.indexOf(dependency) > index) {
        failures.push(`${gate.id} dependency ${dependency} must be declared first`)
      }
    }
  }

  const dependenciesById = new Map(input.map((gate) => [gate.id, gate]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string, path: readonly string[]): void => {
    if (visiting.has(id)) {
      const start = path.indexOf(id)
      failures.push(`roadmap gate dependency cycle: ${[...path.slice(start), id].join(" -> ")}`)
      return
    }
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of dependenciesById.get(id)?.dependencies ?? []) {
      if (dependency !== id && dependenciesById.has(dependency)) visit(dependency, [...path, id])
    }
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of new Set(ids)) visit(id, [])

  return [...new Set(failures)]
}

export const roadmapTracks: readonly RoadmapTrack[] = [
  {
    id: "erp",
    title: "ERP primitives",
    path: "docs/roadmap/erp-primitives.md",
    gateIds: ["erp.p0", "erp.p0-migration", "erp.p1", "erp.p2", "erp.p3"],
  },
  {
    id: "domain",
    title: "Domain maturity",
    path: "docs/roadmap/domain-maturity.md",
    gateIds: [
      "domain.identity-lifecycle",
      "domain.authorization-foundation",
      "domain.capability-grammar",
      "domain.identity.level3",
      "domain.party.level3",
      "domain.inventory.level3",
      "domain.accounting.level3",
      "domain.sales.level3",
      "domain.procurement.level3",
    ],
  },
  {
    id: "financial",
    title: "Financial ledger execution",
    path: "docs/roadmap/financial-ledger-execution.md",
    gateIds: financialGateIds.map((id) => `financial.${id}`),
  },
  {
    id: "process",
    title: "Process Studio",
    path: "docs/roadmap/process-studio.md",
    gateIds: [
      "process.pre08",
      "process.catalog08",
      "process.runtime085",
      "process.fencing087",
      "process.ops09",
      "process.designer095",
      "process.governed10",
    ],
  },
  {
    id: "integration",
    title: "External integration",
    path: "docs/roadmap/integration-surface.md",
    gateIds: [
      "integration.contract08",
      "integration.runtime085",
      "integration.reliability09",
      "integration.process095",
      "integration.governed10",
    ],
  },
  {
    id: "packs",
    title: "Business Pack Library",
    path: "docs/roadmap/process-pack-library.md",
    gateIds: ["packs.contract"],
  },
  {
    id: "postgres19",
    title: "PostgreSQL 19",
    path: "docs/roadmap/postgresql-19.md",
    gateIds: [
      "postgres19.minimum-version",
      "postgres19.wait-for-pilot",
      "postgres19.property-graph-pilot",
      "postgres19.repack-rehearsal",
      "postgres19.production-ga",
    ],
  },
  {
    id: "workload",
    title: "Workload isolation",
    path: "docs/roadmap/workload.md",
    gateIds: ["workload.classify", "workload.command-reserve"],
  },
  {
    id: "frontend",
    title: "Frontend readiness",
    path: "docs/roadmap/frontend.md",
    gateIds: [
      "frontend.shell",
      "frontend.application-boundaries",
      "frontend.design-system",
      "frontend.accessibility-performance",
    ],
  },
  {
    id: "production",
    title: "Production profile readiness",
    path: "docs/roadmap/production.md",
    gateIds: [
      "production.artifacts",
      "production.install-upgrade",
      "production.entry-profile",
    ],
  },
]

const gateGraphFailures = validateGateGraph(gates)
if (gateGraphFailures.length > 0) throw new Error(gateGraphFailures.join("\n"))
