# extensions

Modules from other developers and customers live here, one directory per module, with the same
shape as an `erp/modules/<name>` module. Extensions import only the public entry points of
`framework/` and `erp/` modules ([ADR-0091](../docs/decisions/0091-adopt-framework-and-flagship-erp.md)).
This directory is intentionally empty until the first extension exists.
