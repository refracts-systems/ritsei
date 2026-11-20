# Hierarchy and Graph Selection

> **Status:** Canonical guidance
>
> **Related documents**
>
> - `ltree` notes: [`./reference/ltree-notes.md`](./reference/ltree-notes.md)
> - SQL/PGQ use cases: [`./reference/sql-pgq-use-cases.md`](./reference/sql-pgq-use-cases.md)
> - Selection ADR: [`../decisions/0005-use-ltree-and-sql-pgq-selectively.md`](../decisions/0005-use-ltree-and-sql-pgq-selectively.md)
> - Authorization: [`./authorization.md`](./authorization.md)
> - RelationshipEngine ADR:
>   [`../decisions/0059-define-replaceable-relationship-authorization-engine.md`](../decisions/0059-define-replaceable-relationship-authorization-engine.md)

## Decision Matrix

```text
Relational tables
-> authoritative state and constraints

ltree
-> strict hierarchy and ancestor/descendant traversal

SQL/PGQ
-> multi-edge network traversal for domain analysis and projections

RelationshipEngine
-> native PostgreSQL relationship authorization (SpiceDB withdrawn, ADR-0091)

Application graph registry
-> package dependencies, event topology, and blast-radius analysis
```

## Use `ltree` For

- chart of accounts;
- organizational units;
- warehouse and location hierarchy;
- product categories;
- cost centers;
- geographic regions;
- document folders.

Use stable machine labels in paths. Keep human-readable names separate.

## Use SQL/PGQ For

- multi-level BOM with shared components;
- supply-chain traceability;
- related-party and fraud paths;
- document lineage;
- complex relationship graphs.

A property graph is a read-oriented view over relational tables. It does not
replace the transactional model. A RelationshipEngine is not a general ERP graph
authority; its relationship result is one input to the RITSEI Authorization
decision and never replaces tenant isolation, business policy, or SoD. Native
PostgreSQL is the implementation; the SpiceDB option was withdrawn (ADR-0091). The current Party pilot
is a fixed two-edge, bounded related-path projection and is not an authorization
or mutation authority. `party.related_party_paths` MUST NOT expose reflexive paths
where `source_party_id = target_party_id`; this is a projection invariant, not a
prohibition on cyclic relationships in the underlying Party graph. Source
relationships remain governed by domain rules, while PostgreSQL, memory, and
adapter implementations preserve the non-reflexive result contract.

## Hot-Path Rule

Do not perform complex graph traversal on every request. Use traversal for
analysis or projection construction, then serve hot paths from indexed
effective-state models where appropriate.
