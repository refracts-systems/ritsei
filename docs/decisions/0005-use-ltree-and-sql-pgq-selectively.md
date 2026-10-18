# ADR-0005: Use ltree and SQL/PGQ Selectively

- Status: Accepted
- Date: 2026-08-01
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)

## Context

ERP contains both strict trees and richer networks. Treating every relationship
as either a recursive adjacency list or a generic graph obscures constraints.

## Decision

Use relational tables for authoritative state, `ltree` for strict hierarchies,
and SQL/PGQ for read-oriented multi-edge graph traversal.

## Consequences

Graph capability improves selected queries without replacing relational
transactions or constraints.

## Validation

Benchmark representative hierarchy and graph queries and verify projection
rebuildability.

## Amendment (2026-10-18)

Upstream reverted SQL/PGQ (`CREATE PROPERTY GRAPH` / `GRAPH_TABLE`) from
PostgreSQL 19 after beta 3; it is expected to return at the earliest in
PostgreSQL 20. Until then, read-oriented multi-edge traversal uses relational
joins; the Party related-party path projection keeps its contract
(`party.related_party_paths`) while the property-graph DDL is postponed. The
`ltree` part of this decision is unaffected.
