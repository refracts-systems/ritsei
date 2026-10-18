# apps/web rules

Frontend-specific rules; repository-wide rules are in the root [`AGENTS.md`](../../AGENTS.md).
Architecture: [`frontend.md`](../../docs/architecture/frontend.md),
[`design-system.md`](../../docs/architecture/design-system.md),
[ADR-0010](../../docs/decisions/0010-use-vite-solidjs-spa.md).

- `apps/web/` is a Vite-based SolidJS 2.0 SPA. No SolidStart or SSR without an approved ADR.
- Use Solid Router by default and keep router-specific types behind frontend routing abstractions.
- Remote server state uses TanStack Solid Query; use TanStack Solid Table, Virtual, and Form for
  their specific concerns. Do not mirror query results into unrelated signals or global stores.
- Effect integration defaults to Solid's native reactive graph plus a Solid Context-carried
  `ManagedRuntime` ([ADR-0072](../../docs/decisions/0072-prefer-native-solid-reactivity-for-effect-integration.md)).
  Use Effect Atom only as an explicit opt-in, and never mirror the same fact across both systems.
- Before adding a screen, use the Product Pattern/workspace matrix, shell contract, and route/state
  composition rules in the docs above; reuse the canonical shell instead of inventing page-specific
  navigation.
- Keep route loaders thin: parse input, invoke feature logic, render. Validate API and route
  boundaries with Effect Schema.
- Never import backend implementation modules, Drizzle tables, or repositories. Business policy and
  authorization enforcement stay in the backend.
- Preserve accessibility, keyboard navigation, and semantic HTML.
- Web-only dependencies belong in `apps/web/package.json` with exact pins.
- Build and check: `pnpm --filter @ritsei/web run check` and `... run build`.
