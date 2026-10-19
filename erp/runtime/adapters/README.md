# Application Adapters

`erp/runtime/adapters/` contains adapters at the **application/composition boundary**. This folder
connects public contracts across modules without moving business ownership into `erp/runtime/`.

> **Related documents**
>
> - Runtime and module shape:
>   [`../../docs/architecture/architecture-spec-v4.md`](../../../docs/architecture/architecture-spec-v4.md)
> - Boundary enforcement:
>   [`../../docs/architecture/architecture-enforcement.md`](../../../docs/architecture/architecture-enforcement.md)
> - Cross-domain integration:
>   [`../../.agents/skills/cross-domain-and-transactions/SKILL.md`](../../../.agents/skills/cross-domain-and-transactions/SKILL.md)

## Put code here when

- a port/service owned by one package must be connected to a service from another package;
- the implementation is selected by the composition root;
- the adapter uses only public module entry points (`modules/*/mod.ts`);
- the adapter translates errors or data shapes at the boundary;
- the adapter does not introduce tables, repositories, or new invariants.

## Do not put here

- business workflows or invariants → `modules/<domain>/src/service.ts`;
- persistence, Drizzle, or repositories → the owning module or platform adapter;
- HTTP routes and handlers → `erp/runtime/api`;
- external connectors/providers → `framework/modules/integrations`;
- general-purpose utilities → `framework/foundation/`.

## Current example

`identity-account-authorizer.ts` connects the Identity port to the Authorization service:

```text
IdentityAccountAuthorizer
  → AuthorizationService.authorize
  → IdentityAuthorizationDenied
```

The port and error remain owned by Identity. The adapter only binds the
`identity.user_account.create` capability and translates `AuthorizationDenied`.

The runtime wires it like this:

```ts
const IdentityLive = Layer.effect(UserAccountService, makeUserAccountService).pipe(
  Layer.provide(Layer.mergeAll(
    DatabaseLive,
    IdentityAccountAuthorizerLive.pipe(Layer.provide(AuthorizationLive)),
  )),
)
```

## Shape of a new adapter

```ts
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ExternalService } from "../../modules/external/mod.ts"
import { DomainPort } from "../../modules/domain/mod.ts"

export const DomainPortLive = Layer.effect(
  DomainPort,
  Effect.gen(function* () {
    const external = yield* ExternalService
    return {
      call: (input: string) => external.execute(input),
    }
  }),
)
```

`erp/runtime/layers.ts` remains responsible for selecting and providing dependency layers.

## Another concrete example

`financial-ledger.ts` selects the implementation behind the provider-neutral `FinancialLedgerPort`:

```text
FinancialLedgerPort
  → PostgreSQL ledger
  or
  → TigerBeetle ledger
```

The selection is configuration-driven:

```ts
if (configuration.financialAuthority === "postgresql") {
  return makePostgresqlFinancialLedgerLayer.pipe(Layer.provide(database))
}

return Layer.effect(
  FinancialLedgerPort,
  makeTigerBeetleFinancialLedger(configuration.tigerBeetle),
)
```

This belongs at the application boundary because the runtime chooses the provider. The financial
domain depends on `FinancialLedgerPort`, not on either provider-specific implementation.

## Rule of thumb

If the explanation is **“a port owned by A is implemented using public service B during runtime
composition,”** the adapter belongs here. If the code owns a business decision or persistence, place
it in the owning package instead.
