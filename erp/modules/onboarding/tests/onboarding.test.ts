import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { Etag, HttpPlatform } from "effect/http"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import * as HttpApiTest from "effect/http-api/HttpApiTest"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import { DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import {
  ApiConflict,
  BearerAuth,
  CurrentPrincipal,
  moduleApi,
} from "../../../../framework/modules/http/mod.ts"
import {
  AuthorizationDenied,
  type CapabilityType,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import { validateModuleRegistry } from "../../../../framework/modules/module/mod.ts"
import {
  makePartyTestLayer,
  PartyCapabilities,
  PartyModule,
  PartyService,
  type PartyServiceContract,
} from "../../party/mod.ts"
import {
  ImportBatchHasBlockingErrors,
  ImportBatchNotFound,
  ImportBatchNotRehearsed,
  ImportFileInvalid,
  makeOnboardingTestLayer,
  OnboardingCapabilities,
  OnboardingModule,
  OnboardingService,
  PartyMappingRevision,
  UnsupportedMappingRevision,
} from "../mod.ts"
import { OnboardingHttpGroup, OnboardingHttpHandlers } from "../http.ts"
import { parseCsv } from "../src/csv.ts"

const principal = { userAccountId: "onboarding-user", sessionId: "onboarding-session" }
const tenantId = "018f2000-0000-7000-8000-0000000000bb"
const otherTenantId = "018f2000-0000-7000-8000-0000000000cc"

const grants = (capabilities: ReadonlyArray<CapabilityType>) =>
  capabilities.map((capability) => ({
    userAccountId: principal.userAccountId,
    tenantId,
    capability,
  }))

const allGrants = grants([
  ...Object.values(OnboardingCapabilities),
  PartyCapabilities.partyCreate,
  PartyCapabilities.partyRoleAssign,
  PartyCapabilities.partyRead,
])

const layerWith = (
  granted: ReturnType<typeof grants>,
  decorate: (real: PartyServiceContract) => PartyServiceContract = (real) => real,
) => {
  const authorization = makeAuthorizationTestLayer(granted)
  const party = makePartyTestLayer().pipe(Layer.provide(authorization))

  const decorated = Layer.effect(
    PartyService,
    Effect.gen(function* () {
      return decorate(yield* PartyService)
    }),
  ).pipe(Layer.provide(party))

  return makeOnboardingTestLayer().pipe(Layer.provideMerge(Layer.merge(decorated, authorization)))
}

// A new layer per test: the default memo map would otherwise share one store across tests.
const granted = () => layerWith(allGrants)

const stageInput = (
  csv: string,
  overrides: { sourceInstance?: string; sourceVersion?: string; mappingRevision?: string } = {},
) => ({
  principal,
  tenantId,
  sourceInstance: "accurate-prod",
  objectKind: "party" as const,
  mappingRevision: PartyMappingRevision,
  csv,
  ...overrides,
})

const header = "source_id,kind,name,role"

const file = (...lines: ReadonlyArray<string>) => [header, ...lines].join("\n")

const threeParties = file(
  "C-1,organization,PT Maju Jaya,customer",
  'C-2,organization,"Toko ""Sumber"", Rejeki",supplier',
  "C-3,person,Budi Santoso,",
)

const ref = { principal, tenantId }

const parties = Effect.gen(function* () {
  const party = yield* PartyService

  return yield* party.list({ principal, tenantId })
})

describe("onboarding module", () => {
  it("declares a valid manifest", () => {
    assert.deepStrictEqual(validateModuleRegistry([PartyModule, OnboardingModule]), [])
  })

  describe("CSV reading", () => {
    it("reads quoted fields, escaped quotes, embedded newlines, CRLF, and a byte order mark", () => {
      assert.deepStrictEqual(parseCsv('﻿a,b\r\n"x, ""y""","line\nbreak"\r\n\r\nlast,\n'), [
        ["a", "b"],
        ['x, "y"', "line\nbreak"],
        ["last", ""],
      ])
    })

    it("rejects an unterminated quote and a stray quote", () => {
      assert.isUndefined(parseCsv('a,"b'))
      assert.isUndefined(parseCsv('a,b"c'))
      assert.isUndefined(parseCsv('"a"b,c'))
    })
  })

  describe("staging", () => {
    it.effect("records the file identity and parses every row without a business effect", () =>
      Effect.gen(function* () {
        const onboarding = yield* OnboardingService

        const staged = yield* onboarding.stage(
          stageInput(threeParties, { sourceVersion: "2026.1" }),
        )

        assert.isFalse(staged.alreadyStaged)
        assert.strictEqual(staged.summary.batch.status, "staged")
        assert.strictEqual(staged.summary.batch.sourceInstance, "accurate-prod")
        assert.strictEqual(staged.summary.batch.sourceVersion, "2026.1")
        assert.strictEqual(staged.summary.batch.mappingRevision, PartyMappingRevision)
        assert.strictEqual(staged.summary.batch.uploadedBy, principal.userAccountId)
        assert.match(staged.summary.batch.fileChecksum, /^[0-9a-f]{64}$/)
        assert.deepStrictEqual(
          [staged.summary.pending, staged.summary.invalid, staged.summary.applied],
          [3, 0, 0],
        )
        assert.lengthOf(yield* parties, 0)
      }).pipe(Effect.provide(granted())),
    )

    it.effect("stores the same file once and treats a changed file as a new batch", () =>
      Effect.gen(function* () {
        const onboarding = yield* OnboardingService
        const first = yield* onboarding.stage(stageInput(threeParties))
        const again = yield* onboarding.stage(stageInput(threeParties))

        const otherInstance = yield* onboarding.stage(
          stageInput(threeParties, { sourceInstance: "accurate-test" }),
        )

        const edited = yield* onboarding.stage(stageInput(`${threeParties}\nC-4,person,Siti,`))

        assert.isTrue(again.alreadyStaged)
        assert.strictEqual(again.summary.batch.id, first.summary.batch.id)
        assert.notStrictEqual(otherInstance.summary.batch.id, first.summary.batch.id)
        assert.notStrictEqual(edited.summary.batch.id, first.summary.batch.id)
        assert.notStrictEqual(edited.summary.batch.fileChecksum, first.summary.batch.fileChecksum)
      }).pipe(Effect.provide(granted())),
    )

    it.effect("reports per-record errors by row without echoing source values", () =>
      Effect.gen(function* () {
        const onboarding = yield* OnboardingService

        const staged = yield* onboarding.stage(
          stageInput(
            file(
              "C-1,organization,PT Maju Jaya,customer",
              ",organization,No Id,",
              "C-3,company,Wrong Kind,",
              "C-4,person,   ,",
              "C-5,person,Bad Role,boss",
              "C-6,person,Dup One,",
              "C-6,person,Dup Two,",
              "C-8,person",
            ),
          ),
        )

        assert.deepStrictEqual([staged.summary.pending, staged.summary.invalid], [1, 7])

        const rows = yield* onboarding.listRows({
          ...ref,
          batchId: staged.summary.batch.id,
          status: "invalid",
        })

        assert.deepStrictEqual(
          rows.map((row) => [row.rowNumber, row.errors.map((error) => error.code)]),
          [
            [2, ["source_id_missing"]],
            [3, ["kind_invalid"]],
            [4, ["name_blank"]],
            [5, ["role_invalid"]],
            [6, ["source_id_duplicate"]],
            [7, ["source_id_duplicate"]],
            [8, ["row_malformed"]],
          ],
        )

        const page = yield* onboarding.listRows({
          ...ref,
          batchId: staged.summary.batch.id,
          status: "invalid",
          afterRowNumber: 5,
          limit: 2,
        })

        assert.deepStrictEqual(
          page.map((row) => row.rowNumber),
          [6, 7],
        )

        const leaked = JSON.stringify(rows)

        for (const value of ["Wrong Kind", "Bad Role", "boss", "Dup One", "C-3", "C-6", "C-8"]) {
          assert.notInclude(leaked, value)
        }
      }).pipe(Effect.provide(granted())),
    )

    it.effect("fails the whole file for damage the operator must fix first", () =>
      Effect.gen(function* () {
        const onboarding = yield* OnboardingService
        const reason = (csv: string) => Effect.flip(onboarding.stage(stageInput(csv)))

        const empty = yield* reason("")
        const headerOnly = yield* reason(header)
        const missing = yield* reason("source_id,name\nC-1,Budi")
        const malformed = yield* reason('source_id,kind,name\nC-1,person,"Budi')

        const unsupported = yield* Effect.flip(
          onboarding.stage(stageInput(threeParties, { mappingRevision: "party-csv-v0" })),
        )

        assert.instanceOf(empty, ImportFileInvalid)
        assert.instanceOf(headerOnly, ImportFileInvalid)
        assert.instanceOf(missing, ImportFileInvalid)
        assert.instanceOf(malformed, ImportFileInvalid)

        assert.deepStrictEqual(
          [empty.reason, headerOnly.reason, missing.reason, malformed.reason],
          ["empty", "empty", "missing_column", "malformed_csv"],
        )
        assert.strictEqual(missing.column, "kind")
        assert.instanceOf(unsupported, UnsupportedMappingRevision)
      }).pipe(Effect.provide(granted())),
    )
  })

  describe("rehearsal and apply", () => {
    it.effect("a rehearsal saves a preview and creates nothing", () =>
      Effect.gen(function* () {
        const onboarding = yield* OnboardingService
        const staged = yield* onboarding.stage(stageInput(threeParties))
        const batchId = staged.summary.batch.id
        const rehearsed = yield* onboarding.rehearse({ ...ref, batchId })

        assert.strictEqual(rehearsed.batch.status, "rehearsed")
        assert.strictEqual(rehearsed.batch.rehearsal?.accepted, 3)
        assert.strictEqual(rehearsed.batch.rehearsal?.blocking, 0)
        assert.lengthOf(yield* parties, 0)

        const again = yield* onboarding.rehearse({ ...ref, batchId })

        assert.deepStrictEqual(again.batch.rehearsal?.errors, [])
        assert.lengthOf(yield* parties, 0)
      }).pipe(Effect.provide(granted())),
    )

    it.effect("apply needs a rehearsal and no blocking errors", () =>
      Effect.gen(function* () {
        const onboarding = yield* OnboardingService
        const clean = yield* onboarding.stage(stageInput(threeParties))

        const bad = yield* onboarding.stage(
          stageInput(file("C-1,organization,Ok,", "C-2,galaxy,Bad,")),
        )

        const notRehearsed = yield* Effect.flip(
          onboarding.apply({ ...ref, batchId: clean.summary.batch.id }),
        )

        yield* onboarding.rehearse({ ...ref, batchId: bad.summary.batch.id })

        const blocked = yield* Effect.flip(
          onboarding.apply({ ...ref, batchId: bad.summary.batch.id }),
        )

        assert.instanceOf(notRehearsed, ImportBatchNotRehearsed)
        assert.instanceOf(blocked, ImportBatchHasBlockingErrors)
        assert.strictEqual(blocked.invalidRows, 1)
        assert.lengthOf(yield* parties, 0)
      }).pipe(Effect.provide(granted())),
    )

    it.effect("creates each record once through the owner and maps its source identity", () =>
      Effect.gen(function* () {
        const onboarding = yield* OnboardingService
        const party = yield* PartyService
        const staged = yield* onboarding.stage(stageInput(threeParties))
        const batchId = staged.summary.batch.id

        yield* onboarding.rehearse({ ...ref, batchId })

        const applied = yield* onboarding.apply({ ...ref, batchId })

        assert.deepStrictEqual([applied.created, applied.linked, applied.changed], [3, 0, 0])
        assert.strictEqual(applied.summary.batch.status, "applied")

        const created = yield* parties

        assert.deepStrictEqual(created.map((entry) => entry.party.name).toSorted(), [
          "Budi Santoso",
          "PT Maju Jaya",
          'Toko "Sumber", Rejeki',
        ])

        const rows = yield* onboarding.listRows({ ...ref, batchId })
        const first = rows.find((row) => row.sourceId === "C-1")!
        const detail = yield* party.getDetail({ ...ref, partyId: first.nativeId! })

        assert.deepStrictEqual(detail.roles, ["customer"])

        // Applying again, or staging and applying the same file again, creates nothing more.
        const repeat = yield* onboarding.apply({ ...ref, batchId })

        assert.deepStrictEqual([repeat.created, repeat.linked, repeat.changed], [0, 0, 0])
        assert.lengthOf(yield* parties, 3)
      }).pipe(Effect.provide(granted())),
    )

    it.effect("a later file links unchanged records and reports changed ones without writing", () =>
      Effect.gen(function* () {
        const onboarding = yield* OnboardingService
        const first = yield* onboarding.stage(stageInput(threeParties))

        yield* onboarding.rehearse({ ...ref, batchId: first.summary.batch.id })
        yield* onboarding.apply({ ...ref, batchId: first.summary.batch.id })

        const second = yield* onboarding.stage(
          stageInput(
            file(
              "C-1,organization,PT Maju Jaya,customer",
              "C-2,organization,Renamed Elsewhere,supplier",
              "C-9,person,New Person,",
            ),
          ),
        )

        const preview = yield* onboarding.rehearse({ ...ref, batchId: second.summary.batch.id })

        assert.deepStrictEqual(
          [
            preview.batch.rehearsal?.accepted,
            preview.batch.rehearsal?.alreadyMapped,
            preview.batch.rehearsal?.blocking,
          ],
          [1, 1, 1],
        )
        assert.deepStrictEqual(preview.batch.rehearsal?.errors, [
          { code: "source_record_changed", count: 1 },
        ])
        assert.lengthOf(yield* parties, 3)

        const blocked = yield* Effect.flip(
          onboarding.apply({ ...ref, batchId: second.summary.batch.id }),
        )

        assert.instanceOf(blocked, ImportBatchHasBlockingErrors)
      }).pipe(Effect.provide(granted())),
    )

    it.effect("a source instance is its own identity namespace", () =>
      Effect.gen(function* () {
        const onboarding = yield* OnboardingService

        for (const sourceInstance of ["accurate-prod", "zahir-prod"]) {
          const staged = yield* onboarding.stage(stageInput(threeParties, { sourceInstance }))
          yield* onboarding.rehearse({ ...ref, batchId: staged.summary.batch.id })
          yield* onboarding.apply({ ...ref, batchId: staged.summary.batch.id })
        }

        assert.lengthOf(yield* parties, 6)
      }).pipe(Effect.provide(granted())),
    )

    it.effect("resumes after an interruption without repeating a committed effect", () => {
      let creates = 0

      const interrupted = layerWith(allGrants, (real) => ({
        ...real,
        create: (input) =>
          ++creates === 2
            ? Effect.fail(
                new DatabaseFailure({ operation: "party.create", cause: "connection lost" }),
              )
            : real.create(input),
      }))

      return Effect.gen(function* () {
        const onboarding = yield* OnboardingService
        const staged = yield* onboarding.stage(stageInput(threeParties))
        const batchId = staged.summary.batch.id

        yield* onboarding.rehearse({ ...ref, batchId })

        const failure = yield* Effect.flip(onboarding.apply({ ...ref, batchId }))

        assert.instanceOf(failure, DatabaseFailure)

        const midway = yield* onboarding.getBatch({ ...ref, batchId })

        assert.deepStrictEqual(
          [midway.applied, midway.pending, midway.batch.status],
          [1, 2, "rehearsed"],
        )
        assert.lengthOf(yield* parties, 1)

        const resumed = yield* onboarding.apply({ ...ref, batchId })

        assert.strictEqual(resumed.created, 2)
        assert.strictEqual(resumed.summary.batch.status, "applied")
        assert.lengthOf(yield* parties, 3)
      }).pipe(Effect.provide(interrupted))
    })
  })

  describe("authorization", () => {
    it.effect("denies every operation without its grant", () =>
      Effect.gen(function* () {
        const onboarding = yield* OnboardingService
        const batchId = "018f2000-0000-7000-8000-0000000000dd"

        const denied = yield* Effect.all([
          Effect.flip(onboarding.stage(stageInput(threeParties))),
          Effect.flip(onboarding.getBatch({ ...ref, batchId })),
          Effect.flip(onboarding.listRows({ ...ref, batchId })),
          Effect.flip(onboarding.rehearse({ ...ref, batchId })),
          Effect.flip(onboarding.apply({ ...ref, batchId })),
        ])

        for (const error of denied) assert.instanceOf(error, AuthorizationDenied)
      }).pipe(Effect.provide(layerWith([]))),
    )

    it.effect("apply runs under the operator's own owner grants", () =>
      Effect.gen(function* () {
        const onboarding = yield* OnboardingService
        const staged = yield* onboarding.stage(stageInput(threeParties))
        const batchId = staged.summary.batch.id

        yield* onboarding.rehearse({ ...ref, batchId })

        const denied = yield* Effect.flip(onboarding.apply({ ...ref, batchId }))

        assert.instanceOf(denied, AuthorizationDenied)
        assert.lengthOf(yield* parties, 0)
      }).pipe(
        Effect.provide(
          layerWith(
            grants([...Object.values(OnboardingCapabilities), PartyCapabilities.partyRead]),
          ),
        ),
      ),
    )

    it.effect("keeps batches inside their tenant", () =>
      Effect.gen(function* () {
        const onboarding = yield* OnboardingService
        const staged = yield* onboarding.stage(stageInput(threeParties))

        const outsider = yield* Effect.flip(
          onboarding.getBatch({
            principal,
            tenantId: otherTenantId,
            batchId: staged.summary.batch.id,
          }),
        )

        assert.instanceOf(outsider, AuthorizationDenied)

        const grantedElsewhere = yield* Effect.flip(
          onboarding.getBatch({
            principal,
            tenantId,
            batchId: "018f2000-0000-7000-8000-0000000000ee",
          }),
        )

        assert.instanceOf(grantedElsewhere, ImportBatchNotFound)
      }).pipe(Effect.provide(granted())),
    )
  })
})

const TestHttpServices = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

it.layer(TestHttpServices)("onboarding HTTP endpoints", (it) => {
  it.effect("stages, rehearses, and applies through the bearer-protected routes", () =>
    Effect.gen(function* () {
      const bearer = Layer.succeed(BearerAuth, {
        bearer: (effect) => Effect.provideService(effect, CurrentPrincipal, principal),
      })

      const bearerClient = HttpApiMiddleware.layerClient(BearerAuth, ({ request, next }) =>
        next(HttpClientRequest.bearerToken(request, "onboarding-token")),
      )

      const handlers = OnboardingHttpHandlers.pipe(Layer.provide(bearer), Layer.provide(granted()))

      const client = yield* HttpApiTest.groups(moduleApi(OnboardingHttpGroup), ["Onboarding"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, bearerClient, bearer)),
      )

      const headers = { "x-tenant-id": tenantId }

      const payload = (csv: string) => ({
        sourceInstance: "accurate-prod",
        objectKind: "party" as const,
        mappingRevision: PartyMappingRevision,
        csv,
      })

      const staged = yield* client.Onboarding.stageImport({
        headers,
        payload: payload(file("C-1,organization,PT Maju Jaya,customer", "C-2,person, ,")),
      })

      const params = { id: staged.summary.batch.id }

      assert.deepStrictEqual([staged.summary.pending, staged.summary.invalid], [1, 1])

      const invalid = yield* client.Onboarding.listImportRows({
        headers,
        params,
        query: { status: "invalid" },
      })

      assert.deepStrictEqual(
        invalid[0]?.errors.map((error) => error.code),
        ["name_blank"],
      )

      const notRehearsed = yield* Effect.flip(client.Onboarding.applyImport({ headers, params }))

      assert.instanceOf(notRehearsed, ApiConflict)
      assert.strictEqual(notRehearsed.code, "ImportBatchNotRehearsed")

      const rejected = yield* Effect.flip(
        client.Onboarding.stageImport({ headers, payload: payload("") }),
      )

      assert.instanceOf(rejected, ApiConflict)
      assert.strictEqual(rejected.code, "ImportFileInvalid")

      const clean = yield* client.Onboarding.stageImport({
        headers,
        payload: payload(file("C-1,organization,PT Maju Jaya,customer")),
      })

      const cleanParams = { id: clean.summary.batch.id }
      const rehearsed = yield* client.Onboarding.rehearseImport({ headers, params: cleanParams })

      assert.strictEqual(rehearsed.batch.status, "rehearsed")

      const applied = yield* client.Onboarding.applyImport({ headers, params: cleanParams })

      assert.strictEqual(applied.created, 1)
      assert.strictEqual(
        (yield* client.Onboarding.getImport({ headers, params: cleanParams })).batch.status,
        "applied",
      )
    }),
  )
})
