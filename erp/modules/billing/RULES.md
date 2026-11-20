# Billing Rules

> **Status:** Current rules owned by the Billing module (ADR-0123). This file wins over ADR text for
> what the module does now. It covers invoice rendering staging so far; other Billing rules are not
> yet listed here, and rendering architecture is owned by
> [`document-rendering.md`](../../../docs/architecture/document-rendering.md).

Each rule has an identifier that the test enforcing it names as `[ID]`, in a comment above the test
or in its title; `tests/architecture/modules.test.ts` fails when a rule has no such test or a test
names an unknown rule. A rule no test enforces says `unenforced`.

Why: [ADR-0110](../../../docs/decisions/0110-issue-invoices-as-immutable-numbered-artifacts-and-send-by-communication.md),
[ADR-0122](../../../docs/decisions/0122-stage-invoice-rendering-before-activation.md).

### `BIL-RENDER-1` Invoice rendering is staged, not active

The render job, its migration, the artifact store, and the candidate worker exist for evaluation in
disposable nonproduction databases. No production runtime composes the worker, enqueues it from
invoice posting, exposes an artifact route, or sends customer email; the browser print sheet stays.
This is unenforced by a test; review of runtime composition is the check.

### `BIL-RENDER-2` One immutable, tenant-scoped artifact per issued invoice

PostgreSQL enforces the render input and artifact integrity: the artifact binds the invoice, snapshot
checksum, render fingerprint, versioned assets, renderer version, and output checksum, and staging
needs its capability.
