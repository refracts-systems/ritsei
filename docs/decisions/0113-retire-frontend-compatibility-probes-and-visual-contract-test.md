# ADR-0113: Retire Frontend Compatibility Probes and the Visual Contract Test

- Status: Accepted
- Date: 2026-11-10
- Amends: ADR-0074 (where Kobalte behavior evidence lives), ADR-0079 (pinned dependency, probe, and
  regression test), ADR-0080 (installed development dependency and core probe)
- Compatible with: ADR-0056, ADR-0089, ADR-0112
- Supersedes: ADR-0079's rule that the compatibility probe and regression test remain as evidence
  for the blocked state, and the installed-dependency statements of ADR-0079 and ADR-0080, only
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Design system: [`../architecture/design-system.md`](../architecture/design-system.md)
> - Skeleton architecture: [`../architecture/skeleton.md`](../architecture/skeleton.md)
> - Process Studio architecture: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)

## Context

The testing strategy says tests verify observable behavior and protected invariants. The frontend
test project carried tests that did neither:

- `dnd.test.ts` asserted that `@dnd-kit/solid` does **not** build on Solid 2. The package was
  installed only so that a probe could fail. The test would break on the day upstream fixed the
  package, and no application code imported it.
- `boneyard.test.ts` and `compatibility.test.ts` bundled probe files for `boneyard-js` and Kobalte.
  They tested other people's packages, not RITSEI code.
- The first test in `kobalte.test.ts` built a separate probe application to exercise Kobalte's own
  focus handling. The second test already checked the RITSEI dialog wrapper in the real application.
- `visual-contract.test.ts` compared ten computed CSS properties of sixteen elements in two themes
  with a committed baseline. Every intended design change failed it, and regenerating the baseline
  made it pass, so it could not tell a correct change from a wrong one. ADR-0112 regenerated the
  whole baseline in one step.
- Two tests asserted that constants equal themselves (`motionDuration.normal === 180`,
  `iconRegistry["action.delete"] === "trash"`).

This is the same problem ADR-0089 removed from the roadmap tooling: evidence that is maintained for
its own sake. The repository rule is to delete capabilities that are off the roadmap rather than
gate them.

## Decision

1. Remove `@dnd-kit/solid` and `boneyard-js` from `apps/web/package.json`, the probe files under
   `apps/web/src/ui/compatibility/`, `tooling/frontend/compatibility.ts`, the `compatibility` script,
   and `dnd.test.ts`, `boneyard.test.ts`, and `compatibility.test.ts`.
2. dnd-kit stays the intended drag-and-drop provider and Boneyard stays the intended skeleton
   geometry provider. Neither is installed. Whoever activates one adds the dependency in the same
   change as the RITSEI adapter, and proves it with a production build and a browser test of the
   adapter. The other rules of ADR-0079 and ADR-0080 are unchanged: no shim, no Vite alias, no legacy
   React package, no direct feature import.
3. Kobalte behavior evidence is the browser tests of the RITSEI wrappers in the real application.
   `kobalte.test.ts` now checks keyboard opening, focus containment and restoration, Escape, reduced
   motion, forced colors, and axe WCAG 2A/AA on the sign-out confirmation dialog. A Kobalte pin
   update is validated by the web build and these tests.
4. Remove `visual-contract.test.ts` and its baseline. Design-system Section 23 no longer requires
   visual regression coverage. Shared visual rules that can be stated as a rule keep a test that
   states it: the motion rules of ADR-0112 (`motion.test.ts`), contrast and accessibility through the
   axe scans, and the stylesheet budget.
5. Remove the two constant-equals-constant tests. `motion.test.ts` keeps the tests for the ADR-0112
   rules and for token equality between the Panda config and the runtime; `iconography.test.ts`
   keeps the sprite-and-registry check.

## Alternatives Considered

- **Keep the dnd-kit probe as a tripwire for an upstream fix:** rejected. A dependency that exists
  to fail a build is a cost on every install and audit, and the activation work needs a fresh build
  and browser proof anyway.
- **Replace the computed-style baseline with pixel screenshots:** rejected. Screenshots have the
  same approve-by-regenerating weakness and add platform differences in font rendering.
- **Keep the Kobalte probe application next to the wrapper test:** rejected. Feature code can only
  reach Kobalte through the RITSEI wrappers, so the wrapper is the thing to test.

## Consequences

- An unintended change to a shared color, radius, shadow, or type size is no longer caught by a
  test. It is caught in review of the token or recipe diff and in the screen where it shows.
- The repository no longer records that `@dnd-kit/solid@0.5.0` fails on Solid 2. The reason is
  written in ADR-0079; the current state must be checked again when activation is attempted.
- Two fewer dependencies, one less tooling entry, and a smaller Fallow baseline.
- `tooling/architecture.ts` still forbids feature code from importing Kobalte, dnd-kit, and the
  other internal UI providers.
