// Templates for `ritsei new module <name> --entity <entity>` (ADR-0094): one tenant-scoped record
// with a unique name, read and create capabilities, a table, an HTTP endpoint, and a page.
import type { GeneratedFile } from "./ritsei.ts"

const pascal = (snake: string) =>
  snake
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
const camel = (snake: string) => pascal(snake).charAt(0).toLowerCase() + pascal(snake).slice(1)
const kebab = (snake: string) => snake.replaceAll("_", "-")
const human = (snake: string) => {
  const words = snake.replaceAll("_", " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const entityNames = (module: string, entity: string) => ({
  module,
  Module: pascal(module),
  moduleCamel: camel(module),
  modulePath: kebab(module),
  moduleLabel: human(module),
  entity,
  Entity: pascal(entity),
  entityCamel: camel(entity),
  entityLabel: human(entity),
  table: `${entity}s`,
  tableCamel: camel(`${entity}s`),
  Entities: pascal(`${entity}s`),
  entitiesPath: kebab(`${entity}s`),
  entitiesLabel: human(`${entity}s`).toLowerCase(),
})
export type EntityNames = ReturnType<typeof entityNames>

const backendFiles = (n: EntityNames): readonly GeneratedFile[] => {
  const root = `erp/modules/${n.module}`
  return [
    {
      path: `${root}/manifest.ts`,
      content: `import { defineModule } from "../../../framework/modules/module/mod.ts"
import { ${n.Module}Capabilities } from "./src/capabilities.ts"

export const ${n.Module}Module = defineModule({
  name: "${n.module}",
  layer: "erp",
  dependsOn: [],
  schemas: ["${n.module}"],
  capabilities: ${n.Module}Capabilities,
  actions: [],
  events: [],
  consumes: [],
  http: ["${n.Module}"],
  pages: ["/${n.modulePath}"],
})
`,
    },
    {
      path: `${root}/mod.ts`,
      content: `export { ${n.Module}Capabilities } from "./src/capabilities.ts"
export {
  Create${n.Entity}Input,
  ${n.Entity},
  List${n.Entities}Input,
  ${n.Module}Service,
} from "./src/contract.ts"
export type { ${n.Entity} as ${n.Entity}Type, ${n.Module}Service as ${n.Module}ServiceShape } from "./src/contract.ts"
export { ${n.Entity}AlreadyExists } from "./src/errors.ts"
export { make${n.Module}Service, make${n.Module}TestLayer, ${n.Module}Live } from "./src/layers.ts"
export { ${n.Module}Module } from "./manifest.ts"
`,
    },
    {
      path: `${root}/src/capabilities.ts`,
      content: `// Deny by default: a tenant administrator must grant each capability before it takes effect.
export const ${n.Module}Capabilities = {
  ${n.entityCamel}Read: "${n.module}.${n.entity}.read",
  ${n.entityCamel}Create: "${n.module}.${n.entity}.create",
} as const
`,
    },
    {
      path: `${root}/src/errors.ts`,
      content: `import * as Schema from "effect/Schema"

export class ${n.Entity}AlreadyExists extends Schema.TaggedError<${n.Entity}AlreadyExists>()(
  "${n.Entity}AlreadyExists",
  { tenantId: Schema.String, name: Schema.String },
) {}
`,
    },
    {
      path: `${root}/src/contract.ts`,
      content: `import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { ${n.Entity}AlreadyExists } from "./errors.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const Name = Schema.String.check(
  Schema.makeFilter((value) => /\\S/.test(value) && value === value.trim() && value.length <= 256, {
    expected: "a trimmed nonblank name of at most 256 characters",
  }),
)
const ScopedInput = { principal: Principal, tenantId: Uuid }

export const ${n.Entity} = Schema.Struct({ id: Uuid, tenantId: Uuid, name: Name })
export type ${n.Entity} = Schema.Schema.Type<typeof ${n.Entity}>

export const List${n.Entities}Input = Schema.Struct({
  ...ScopedInput,
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
})
export const Create${n.Entity}Input = Schema.Struct({ ...ScopedInput, name: Name })
export type List${n.Entities}Command = Schema.Schema.Type<typeof List${n.Entities}Input>
export type Create${n.Entity}Command = Schema.Schema.Type<typeof Create${n.Entity}Input>

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export interface ${n.Module}Service {
  readonly list${n.Entities}: (input: unknown) => Effect.Effect<ReadonlyArray<${n.Entity}>, CommonFailure>
  readonly create${n.Entity}: (
    input: unknown,
  ) => Effect.Effect<${n.Entity}, ${n.Entity}AlreadyExists | CommonFailure>
}

export const ${n.Module}Service = Context.Service<${n.Module}Service>("RITSEI/${n.Module}Service")
`,
    },
    {
      path: `${root}/src/store.ts`,
      content: `import type * as Effect from "effect/Effect"

import type { DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import type { Create${n.Entity}Command, ${n.Entity}, List${n.Entities}Command } from "./contract.ts"
import type { ${n.Entity}AlreadyExists } from "./errors.ts"

export interface ${n.Module}Store {
  readonly list${n.Entities}: (
    command: List${n.Entities}Command,
  ) => Effect.Effect<ReadonlyArray<${n.Entity}>, DatabaseFailure>
  readonly create${n.Entity}: (
    command: Create${n.Entity}Command,
  ) => Effect.Effect<${n.Entity}, ${n.Entity}AlreadyExists | DatabaseFailure>
}
`,
    },
    {
      path: `${root}/src/postgres.ts`,
      content: `import { asc, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"

import { ${n.tableCamel} } from "../../../../db/schema/${n.module}.ts"
import { Database, isDatabaseConstraint } from "../../../../framework/foundation/mod.ts"
import type { Create${n.Entity}Command, List${n.Entities}Command } from "./contract.ts"
import { ${n.Entity}AlreadyExists } from "./errors.ts"
import type { ${n.Module}Store } from "./store.ts"

const selection = {
  id: ${n.tableCamel}.id,
  tenantId: ${n.tableCamel}.tenantId,
  name: ${n.tableCamel}.name,
}

export const make${n.Module}PostgresStore = Effect.fn("${n.Module}.makePostgresStore")(function* () {
  const database = yield* Database
  const list${n.Entities} = Effect.fn("${n.Module}Store.list${n.Entities}")(function* (
    command: List${n.Entities}Command,
  ) {
    return yield* database.query(
      (db) =>
        db
          .select(selection)
          .from(${n.tableCamel})
          .where(eq(${n.tableCamel}.tenantId, command.tenantId))
          .orderBy(asc(${n.tableCamel}.name), asc(${n.tableCamel}.id))
          .limit(command.limit ?? 200),
      "${n.module}.${n.entity}.list",
    )
  })
  const create${n.Entity} = Effect.fn("${n.Module}Store.create${n.Entity}")(function* (
    command: Create${n.Entity}Command,
  ) {
    const rows = yield* database
      .query(
        (db) =>
          db
            .insert(${n.tableCamel})
            .values({ tenantId: command.tenantId, name: command.name })
            .returning(selection),
        "${n.module}.${n.entity}.create",
      )
      .pipe(
        Effect.mapError((error) =>
          isDatabaseConstraint(error, "${n.table}_tenant_name_key")
            ? new ${n.Entity}AlreadyExists({ tenantId: command.tenantId, name: command.name })
            : error,
        ),
      )
    return rows[0]!
  })
  return { list${n.Entities}, create${n.Entity} } satisfies ${n.Module}Store
})
`,
    },
    {
      path: `${root}/src/memory.ts`,
      content: `import * as Effect from "effect/Effect"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import type { ${n.Entity} } from "./contract.ts"
import { ${n.Entity}AlreadyExists } from "./errors.ts"
import type { ${n.Module}Store } from "./store.ts"

/** Deterministic test store that keeps the same tenant-scoped unique-name invariant. */
export const make${n.Module}MemoryStore = (): ${n.Module}Store => {
  const records: ${n.Entity}[] = []
  return {
    list${n.Entities}: (command) =>
      Effect.sync(() =>
        records
          .filter((record) => record.tenantId === command.tenantId)
          .toSorted((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
          .slice(0, command.limit ?? 200),
      ),
    create${n.Entity}: (command) =>
      Effect.suspend(() => {
        const duplicate = records.some(
          (record) => record.tenantId === command.tenantId && record.name === command.name,
        )
        if (duplicate) {
          return Effect.fail(
            new ${n.Entity}AlreadyExists({ tenantId: command.tenantId, name: command.name }),
          )
        }
        const record = { id: uuidv7(), tenantId: command.tenantId, name: command.name }
        records.push(record)
        return Effect.succeed(record)
      }),
  }
}
`,
    },
    {
      path: `${root}/src/service.ts`,
      content: `import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { Principal } from "../../../../framework/modules/auth/mod.ts"
import { AuthorizationService } from "../../../../framework/modules/authorization/mod.ts"
import { ${n.Module}Capabilities } from "./capabilities.ts"
import { Create${n.Entity}Input, List${n.Entities}Input, ${n.Module}Service } from "./contract.ts"
import type { ${n.Module}Store } from "./store.ts"

export const make${n.Module}ServiceFromStore = <R>(storeEffect: Effect.Effect<${n.Module}Store, never, R>) =>
  Effect.gen(function* () {
    const store = yield* storeEffect
    const authorization = yield* AuthorizationService
    const authorize = (
      input: { principal: Schema.Schema.Type<typeof Principal>; tenantId: string },
      capability: string,
    ) =>
      authorization.authorize({ principal: input.principal, tenantId: input.tenantId, capability })

    const list${n.Entities} = Effect.fn("${n.Module}Service.list${n.Entities}")(function* (input: unknown) {
      const decoded = yield* Schema.decodeUnknownEffect(List${n.Entities}Input)(input)
      yield* authorize(decoded, ${n.Module}Capabilities.${n.entityCamel}Read)
      return yield* store.list${n.Entities}(decoded)
    })
    const create${n.Entity} = Effect.fn("${n.Module}Service.create${n.Entity}")(function* (input: unknown) {
      const decoded = yield* Schema.decodeUnknownEffect(Create${n.Entity}Input)(input)
      yield* authorize(decoded, ${n.Module}Capabilities.${n.entityCamel}Create)
      return yield* store.create${n.Entity}(decoded)
    })

    return { list${n.Entities}, create${n.Entity} } satisfies ${n.Module}Service
  })
`,
    },
    {
      path: `${root}/src/layers.ts`,
      content: `import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { ${n.Module}Service } from "./contract.ts"
import { make${n.Module}MemoryStore } from "./memory.ts"
import { make${n.Module}PostgresStore } from "./postgres.ts"
import { make${n.Module}ServiceFromStore } from "./service.ts"

export const make${n.Module}Service = make${n.Module}ServiceFromStore(make${n.Module}PostgresStore())
export const ${n.Module}Live = Layer.effect(${n.Module}Service, make${n.Module}Service)
export const make${n.Module}TestLayer = () =>
  Layer.effect(${n.Module}Service, make${n.Module}ServiceFromStore(Effect.succeed(make${n.Module}MemoryStore())))
`,
    },
    {
      path: `${root}/http.ts`,
      content: `// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as Schema from "effect/Schema"

import {
  ApiErrors,
  BaseApiErrorPolicy,
  BearerAuth,
  CurrentPrincipal,
  makeApiErrorMapping,
  makeModuleApi,
  ReadLimit,
  ShortString,
  TenantHeaders,
} from "../../../framework/modules/http/mod.ts"
import { ${n.Entity}, ${n.Module}Service } from "./mod.ts"

export const ${n.Module}HttpGroup = HttpApiGroup.make("${n.Module}").add(
  HttpApiEndpoint.get("list${n.Entities}", "/${n.modulePath}/${n.entitiesPath}", {
    headers: TenantHeaders,
    query: { limit: ReadLimit },
    success: Schema.Array(${n.Entity}),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("create${n.Entity}", "/${n.modulePath}/${n.entitiesPath}", {
    headers: TenantHeaders,
    payload: Schema.Struct({ name: ShortString }),
    success: ${n.Entity}.pipe(HttpApiSchema.status(201)),
    error: ApiErrors,
  }).middleware(BearerAuth),
)

const ${n.Module}HttpApi = makeModuleApi(${n.Module}HttpGroup)

export const ${n.Module}HttpErrors = makeApiErrorMapping({
  ...BaseApiErrorPolicy,
  ${n.Entity}AlreadyExists: "conflict",
})

export const ${n.Module}HttpHandlers = HttpApiBuilder.group(${n.Module}HttpApi, "${n.Module}", (handlers) =>
  Effect.gen(function* () {
    const service = yield* ${n.Module}Service
    return handlers
      .handle(
        "list${n.Entities}",
        Effect.fn("Http.${n.Module}.list${n.Entities}")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal
          return yield* ${n.Module}HttpErrors.apiEffect(
            service.list${n.Entities}({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "create${n.Entity}",
        Effect.fn("Http.${n.Module}.create${n.Entity}")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* ${n.Module}HttpErrors.apiEffect(
            service.create${n.Entity}({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
  }),
)
`,
    },
    {
      path: `${root}/tests/${n.module}.test.ts`,
      content: `import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { Etag, HttpPlatform } from "effect/http"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import * as HttpApiTest from "effect/http-api/HttpApiTest"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import {
  AuthorizationDenied,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import { BearerAuth, CurrentPrincipal, makeModuleApi } from "../../../../framework/modules/http/mod.ts"
import { validateModuleRegistry } from "../../../../framework/modules/module/mod.ts"
import { ${n.Module}HttpGroup, ${n.Module}HttpHandlers } from "../http.ts"
import {
  ${n.Entity}AlreadyExists,
  make${n.Module}TestLayer,
  ${n.Module}Capabilities,
  ${n.Module}Module,
  ${n.Module}Service,
} from "../mod.ts"

const principal = { userAccountId: "${n.module}-user", sessionId: "${n.module}-session" }
const tenantId = "018f2000-0000-7000-8000-0000000000aa"
const grants = Object.values(${n.Module}Capabilities).map((capability) => ({
  userAccountId: principal.userAccountId,
  tenantId,
  capability,
}))
const granted = make${n.Module}TestLayer().pipe(Layer.provide(makeAuthorizationTestLayer(grants)))
const ungranted = make${n.Module}TestLayer().pipe(Layer.provide(makeAuthorizationTestLayer([])))

const TestHttpServices = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

describe("${n.module} module", () => {
  it("declares a valid manifest", () => {
    assert.deepStrictEqual(validateModuleRegistry([${n.Module}Module]), [])
  })

  it.effect("creates and lists tenant ${n.entitiesLabel} with unique names", () =>
    Effect.gen(function* () {
      const service = yield* ${n.Module}Service
      const created = yield* service.create${n.Entity}({ principal, tenantId, name: "First" })
      assert.deepStrictEqual(yield* service.list${n.Entities}({ principal, tenantId }), [created])
      const duplicate = yield* Effect.flip(
        service.create${n.Entity}({ principal, tenantId, name: "First" }),
      )
      assert.instanceOf(duplicate, ${n.Entity}AlreadyExists)
    }).pipe(Effect.provide(granted)),
  )

  it.effect("denies operations without a granted capability", () =>
    Effect.gen(function* () {
      const service = yield* ${n.Module}Service
      const denied = yield* Effect.flip(service.list${n.Entities}({ principal, tenantId }))
      assert.instanceOf(denied, AuthorizationDenied)
    }).pipe(Effect.provide(ungranted)),
  )
})

it.layer(TestHttpServices)("${n.module} HTTP endpoint", (it) => {
  it.effect("serves create and list through the bearer-protected routes", () =>
    Effect.gen(function* () {
      const bearer = Layer.succeed(BearerAuth, {
        bearer: (effect) => Effect.provideService(effect, CurrentPrincipal, principal),
      })
      const bearerClient = HttpApiMiddleware.layerClient(BearerAuth, ({ request, next }) =>
        next(HttpClientRequest.bearerToken(request, "${n.module}-token")),
      )
      const handlers = ${n.Module}HttpHandlers.pipe(Layer.provide(bearer), Layer.provide(granted))
      const client = yield* HttpApiTest.groups(makeModuleApi(${n.Module}HttpGroup), ["${n.Module}"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, bearerClient, bearer)),
      )
      const headers = { "x-tenant-id": tenantId }
      const created = yield* client.${n.Module}.create${n.Entity}({ headers, payload: { name: "Via HTTP" } })
      assert.strictEqual(created.name, "Via HTTP")
      assert.deepStrictEqual(yield* client.${n.Module}.list${n.Entities}({ headers, query: {} }), [created])
    }),
  )
})
`,
    },
  ]
}

const databaseFiles = (n: EntityNames): readonly GeneratedFile[] => [
  {
    path: `db/schema/${n.module}.ts`,
    content: `import { sql } from "drizzle-orm"
import { check, foreignKey, pgSchema, text, unique, uuid } from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, updatedAt } from "./common.ts"

export const ${n.moduleCamel}Schema = pgSchema("${n.module}")

export const ${n.tableCamel} = ${n.moduleCamel}Schema.table(
  "${n.table}",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("${n.table}_tenant_id_id_key").on(table.tenantId, table.id),
    unique("${n.table}_tenant_name_key").on(table.tenantId, table.name),
    check(
      "${n.table}_name_check",
      sql\`\${table.name} = btrim(\${table.name}) and \${table.name} ~ '[^[:space:]]'\`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "${n.table}_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)
`,
  },
]

const webFiles = (n: EntityNames): readonly GeneratedFile[] => [
  {
    path: `apps/web/src/features/${n.module}/service.ts`,
    content: `import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { decodeInput, decodeResponse, mutationRequest, requestJson } from "../../shared/api.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const Name = Schema.String.check(Schema.isPattern(/\\S/), Schema.isMaxLength(256))

/** Browser view of the ${n.entityLabel} transport contract served by the ${n.module} module. */
export const ${n.Entity} = Schema.Struct({ id: Uuid, tenantId: Uuid, name: Name })
export type ${n.Entity} = Schema.Schema.Type<typeof ${n.Entity}>
const ${n.Entity}List = Schema.Array(${n.Entity}).check(Schema.isMaxLength(200))
const Create${n.Entity}Input = Schema.Struct({ name: Name })
const route = "/${n.modulePath}/${n.entitiesPath}"

export const list${n.Entities} = Effect.fn("Frontend.${n.Module}.list${n.Entities}")(function* () {
  const body = yield* requestJson(route)
  return yield* decodeResponse(${n.Entity}List, body)
})

export const create${n.Entity} = Effect.fn("Frontend.${n.Module}.create${n.Entity}")(function* (
  input: unknown,
) {
  const decoded = yield* decodeInput(Create${n.Entity}Input, input)
  const body = yield* mutationRequest(route, "POST", decoded)
  return yield* decodeResponse(${n.Entity}, body, "unknown-outcome")
})
`,
  },
  {
    path: `apps/web/src/features/${n.module}/queries.ts`,
    content: `import { useMutation, useQueryClient } from "@tanstack/solid-query"
import { type RequestFailure } from "../../shared/api.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery, serverQueryKey } from "../../shared/server-query.ts"
import { create${n.Entity}, type ${n.Entity}, list${n.Entities} } from "./service.ts"

const ${n.entityCamel}sKey = ["${n.module}", "${n.table}"] as const

export function create${n.Entities}Query(scope: ApiScope) {
  return createServerQuery<readonly ${n.Entity}[], RequestFailure>({
    tenantId: scope.tenantId,
    key: ${n.entityCamel}sKey,
    cache: "collection",
    load: ({ signal }) => runRequest(scope, list${n.Entities}(), signal),
  })
}

export function create${n.Entity}Mutation(scope: ApiScope, afterSuccess?: () => void) {
  const client = useQueryClient()
  return useMutation<${n.Entity}, RequestFailure, { name: string }>(() => ({
    mutationFn: (input) => runRequest(scope, create${n.Entity}(input)),
    onSuccess: () => {
      afterSuccess?.()
      return client.invalidateQueries({ queryKey: serverQueryKey(scope.tenantId, ${n.entityCamel}sKey) })
    },
  }))
}
`,
  },
  {
    path: `apps/web/src/features/${n.module}/${n.module}.tsx`,
    content: `import { createSignal, Show, useContext } from "solid-js"
import { CommandFeedback, QueryBoundary } from "../../shared/request-feedback.tsx"
import { ApiRuntime } from "../../shared/runtime.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { DataTable } from "../../ui/patterns/data-table.tsx"
import { Button } from "../../ui/primitives/button.tsx"
import { createDialogOpenChange, Dialog } from "../../ui/primitives/dialog.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form } from "../../ui/primitives/form.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { create${n.Entity}Mutation, create${n.Entities}Query } from "./queries.ts"
import type { ${n.Entity} } from "./service.ts"

function ${n.Entity}Table(props: { records: readonly ${n.Entity}[] }) {
  return (
    <DataTable
      surface={false}
      tableClass={layout.collectionTable}
      caption="${n.moduleLabel} ${n.entitiesLabel} in this tenant"
      rows={props.records}
      columns={[
        { id: "name", header: "Name", rowHeader: true, cell: (record) => record.name },
        {
          id: "reference",
          header: "ID",
          cell: (record) => <span class={layout.rowReference}>{record.id}</span>,
        },
      ]}
    />
  )
}

function Create${n.Entity}Dialog(props: { reload: () => Promise<unknown> }) {
  const scope = useContext(ApiRuntime)
  const [open, setOpen] = createSignal(false)
  const [invalid, setInvalid] = createSignal(false)
  let formElement: HTMLFormElement | undefined
  const mutation = create${n.Entity}Mutation(scope, () => {
    formElement?.reset()
    setOpen(false)
  })
  return (
    <Dialog
      open={open()}
      onOpenChange={createDialogOpenChange(mutation, setOpen, setInvalid)}
      trigger={<span>Create ${n.entityLabel.toLowerCase()}</span>}
      triggerVariant="primary"
      title="Create ${n.entityLabel.toLowerCase()}"
      description="Names are unique within this tenant."
    >
      <Form
        ref={(element) => {
          formElement = element
        }}
        class={layout.stack}
        onSubmit={(value) => {
          const name = typeof value.name === "string" ? value.name.trim() : ""
          setInvalid(name === "")
          if (name !== "" && !mutation.isPending) mutation.mutate({ name })
        }}
      >
        <FormField label="Name" required error={invalid() ? "Enter a nonblank name." : undefined}>
          {(fieldProps) => (
            <Input {...fieldProps} name="name" autocomplete="off" required disabled={mutation.isPending} />
          )}
        </FormField>
        <CommandFeedback
          error={mutation.error}
          pending={mutation.isPending}
          success={mutation.isSuccess}
          successMessage="${n.entityLabel} created."
          area="${n.module}"
          reload={props.reload}
          reset={() => mutation.reset()}
        />
        <Button variant="primary" type="submit" loading={mutation.isPending}>
          Create ${n.entityLabel.toLowerCase()}
        </Button>
      </Form>
    </Dialog>
  )
}

export function ${n.Module}() {
  const scope = useContext(ApiRuntime)
  const query = create${n.Entities}Query(scope)
  return (
    <section class={layout.stack} aria-label="${n.moduleLabel}">
      <header class={layout.workspaceHeading}>
        <div class={layout.workspaceTitle}>
          <h1>${n.moduleLabel}</h1>
          <p class={layout.workspaceDescription}>${human(`${n.entity}s`)} recorded in this tenant.</p>
        </div>
        <Create${n.Entity}Dialog reload={() => query.refetch()} />
      </header>
      <QueryBoundary label="${n.entitiesLabel}" retry={() => query.refetch()}>
        <Show
          when={query.data.length > 0}
          fallback={
            <div class={layout.emptyCollection} role="status">
              <p>No ${n.entitiesLabel} yet.</p>
            </div>
          }
        >
          <${n.Entity}Table records={query.data} />
        </Show>
      </QueryBoundary>
    </section>
  )
}
`,
  },
  {
    path: `apps/web/src/app/modules/${n.module}.tsx`,
    content: `import { ${n.Module} } from "../../features/${n.module}/${n.module}.tsx"
import { ConnectedSessionRoute } from "../connected-route.tsx"

export default function ${n.Module}Route() {
  return (
    <ConnectedSessionRoute title="${n.moduleLabel}" description="Connect a valid session to view ${n.entitiesLabel}.">
      {() => <${n.Module} />}
    </ConnectedSessionRoute>
  )
}
`,
  },
  {
    path: `apps/web/src/app/modules/${n.module}.workspace.ts`,
    content: `import type { ModuleWorkspace } from "../workspace.ts"

export const workspace = {
  label: "${n.moduleLabel}",
  description: "${human(`${n.entity}s`)} for this tenant.",
  icon: "object.product",
  order: 100,
} as const satisfies ModuleWorkspace
`,
  },
]

export const renderEntityModule = (names: EntityNames): readonly GeneratedFile[] => [
  ...backendFiles(names),
  ...databaseFiles(names),
  ...webFiles(names),
]
