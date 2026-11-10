# ADR-0076: Adopt the RITSEI Typography System

- Status: Accepted
- Date: 2026-09-05
- Amends: ADR-0056 for typography direction and implementation
- Compatible with: ADR-0069, ADR-0074
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Decision map: [`./decision-map.md`](./decision-map.md)
> - Design system: [`../architecture/design-system.md`](../architecture/design-system.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
>
## Context

RITSEI is an information-dense enterprise product. Typography must clarify hierarchy,
state, identifiers, monetary values, and available actions without becoming decoration or
looking like a generic SaaS template. The previous design-system guidance left the primary
family open and the implementation still used a generic Arial stack.

## Decision

RITSEI adopts the following typography stack:

```text
Product UI and marketing  Pretendard
Technical information     IBM Plex Mono
Future brand/display      Söhne, only when brand investment is justified
```

Pretendard remains the product workhorse if Söhne is adopted later. IBM Plex Mono is
restricted to identifiers, code-like values, and technical information where fixed-width
characters provide semantic value. Instrument Sans, Inter, and Geist are not primary UI
families for the current product direction.

The system uses a deliberately small scale:

```text
12 / 16   xs
13 / 18   sm
14 / 20   md      default application text
16 / 24   lg
18 / 26   xl
20 / 28   2xl
24 / 32   3xl     page title
32 / 40   4xl     restrained display
```

Supported UI weights are 400 regular, 500 medium, and 600 semibold. Components use
semantic text styles from `apps/web/panda.config.ts` through
`apps/web/src/ui/foundations/typography.ts`; feature code must not invent arbitrary typography values.
Tables and financial values use tabular numerals. Primary information must not fall below
12px, and typography must remain usable under zoom, OS scaling, long labels, and localization.

Font family tokens define the required stacks and fallbacks. The web application currently
bundles static WOFF2 weights through `@fontsource/pretendard` and `@fontsource/ibm-plex-mono`.
The corresponding SIL Open Font License notices live under `licenses/fonts/`. A future approved
variable Pretendard asset may replace the static files without changing the semantic contract.
Söhne remains unbundled until its future brand decision is approved.

## Consequences

### Positive

- Dense business information has a stable, legible hierarchy.
- Product UI avoids default SaaS typography while remaining restrained.
- Identifiers and technical values are visually comparable without turning the whole UI into a console.
- A future brand/display face can be added without disturbing operational UI.
- Semantic text styles make typography reviewable and prevent local drift.

### Negative

- The current static font assets add web bundle weight; variable-font adoption remains a measured
  optimization rather than a prerequisite.
- Contributors must choose the correct semantic style instead of reaching for a one-off size.
- Localization and zoom reviews remain required for dense screens.

## Validation

- Panda token and text-style generation succeeds.
- Frontend type checking and existing accessibility/browser tests remain green.
- Storybook exposes the typography foundation for human review.
- The web bundle loads the selected Pretendard and IBM Plex Mono weights, with OFL notices checked in.
- No Söhne asset or expressive display treatment is introduced by this decision.

## Related Documents

- [`../architecture/design-system.md`](../architecture/design-system.md)
- [`./0056-adopt-ritsei-semantic-frontend-design-system.md`](./0056-adopt-ritsei-semantic-frontend-design-system.md)
- [`./0069-adopt-cartographic-enterprise-visual-grammar.md`](./archive/0069-adopt-cartographic-enterprise-visual-grammar.md)
- [`./0074-switch-to-kobalte-for-solid2-accessible-primitives.md`](./0074-switch-to-kobalte-for-solid2-accessible-primitives.md)
