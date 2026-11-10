# ADR-0074: Use Kobalte for Solid 2 Accessible Primitives

- Status: Accepted
- Date: 2026-09-05
- Amends: ADR-0010 only for the accessible primitive selection
- Supersedes: ADR-0056 only for the accessible primitive selection
- Compatible with: ADR-0009, ADR-0057, ADR-0072
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Decision map: [`./decision-map.md`](./decision-map.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Design-system architecture: [`../architecture/design-system.md`](../architecture/design-system.md)
>
## Context

ADR-0056 selected Ark UI as the headless primitive source, but the Solid 2 compatibility spike
showed that the selected Ark release imports `solid-js/web`, which is not exported by the pinned
`solid-js@2.0.0-rc.6` package. RITSEI does not hide that incompatibility with a module alias or
runtime shim.

Kobalte's stable `0.13.x` line targets Solid 1. The Kobalte `2.0.0-alpha.1` line is the available
Solid 2-oriented release and bundles the dialog probe successfully with RITSEI's pinned Solid 2
RC.6 packages. Its exact peer range still names earlier Solid 2 RCs. That mismatch is an explicit,
named prerelease risk that RITSEI accepts under the bounded policy below; it is not treated as a
silent compatibility pass.

## Decision

RITSEI uses **Kobalte** as the single headless accessible primitive source behind RITSEI-owned UI
contracts.

- Pin `@kobalte/core@2.0.0-alpha.1` from the root `package.json` and retain the committed
  `deno.lock`; do not use the stable Solid 1 line while the application targets Solid 2.
- Automatic dependency upgrades are not allowed for this boundary. A version change requires a
  deliberate pin update, compatibility/build validation, browser evidence, and rollback review.
- Keep Kobalte imports inside `apps/web/src/ui/`. Feature code consumes RITSEI-owned UI contracts.
- Keep native semantic HTML as the default and fallback for controls that do not need a headless
  primitive.
- Accept the Solid 2 RC peer-range mismatch only as `approved_with_risk` when the bundle/build
  checks and the RITSEI-owned browser behavior test pass. A compatibility or behavior failure is
  `blocked`, not an accepted risk.
- Approve production use per exercised primitive, never globally. Each activated primitive must
  have a RITSEI wrapper, an application usage path, and a browser interaction/accessibility test.
  Unused or untested Kobalte primitives are not approved. The current evidence activates none.
- Do not alias or shim `solid-js/web` to conceal incompatible packages.
- Focus, keyboard, screen-reader, localization, contrast, reduced-motion, zoom, and long-session
  review remain required for the relevant design-system and accessibility gates.

Panda CSS remains the styling substrate. This decision does not create a separate design-system
package, component catalog, or new frontend dependency boundary.

## Alternatives considered

### Keep Ark UI

Rejected for the current Solid 2 pin because the selected release does not bundle without a
`solid-js/web` export that Solid 2 RC.6 does not provide.

### Use stable Kobalte 0.13.x

Rejected because its peer contract targets Solid 1 rather than the application’s Solid 2 runtime.

### Alias `solid-js/web`

Rejected because it would hide a renderer/package compatibility defect and make runtime behavior
less trustworthy.

### Use native HTML only

Retained as the default and fallback, but not selected as the only primitive strategy for future
composite controls that need tested headless behavior.

## Consequences

- The Kobalte dialog probe passes the Vite/Solid 2 bundle check and the browser-level dialog
  behavior/accessibility check.
- The selected Kobalte package is alpha software with an RC peer-range mismatch. The mismatch is
  accepted only within the named `approved_with_risk` evidence record; it no longer blocks the
  dependency boundary by itself.
- No production Kobalte primitive is activated by this ADR alone. Existing native controls remain
  valid, and the current evidence lists no production primitive.
- Rollback is removing the Kobalte import and returning to the existing semantic HTML fallback.
- The design-system and frontend roadmap gates remain blocked until their other evidence and
  upstream dependencies are complete.

## Validation

The implementation currently proves:

```text
deno task --cwd apps/web compatibility  -> build passed; bundle behavior is not run by this task
deno task test tests/frontend/kobalte.test.ts -> browser behavior/accessibility passed
deno task --cwd apps/web check           -> passed
```

The first line is a bundle compatibility result, not approval of Kobalte accessibility behavior.
The exact pinned dependency and peer warning remain part of the review record.

## Related documents

- [`../architecture/frontend.md`](../architecture/frontend.md)
- [`../architecture/design-system.md`](../architecture/design-system.md)
- [`./0056-adopt-ritsei-semantic-frontend-design-system.md`](./0056-adopt-ritsei-semantic-frontend-design-system.md)
