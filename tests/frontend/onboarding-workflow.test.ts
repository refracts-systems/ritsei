import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Page } from "playwright"
import type {
  ApplyImportResult,
  ImportBatchSummary,
  ImportRow,
} from "../../erp/modules/onboarding/mod.ts"
import { builtApp, conflictBody, connectToTenant, fulfillJson, mockRoutes } from "./browser.ts"

const tenantId = "01900000-0000-7000-8000-000000000010"
const operatorId = "01900000-0000-7000-8000-000000000001"
const rejectedBatchId = "01900000-0000-7000-8000-000000000020"
const batchId = "01900000-0000-7000-8000-000000000021"
const sourceInstance = "Legacy ERP"
const timestamp = "2026-11-20T10:00:00.000Z"
const invalidCsv = "source_id,kind,name,role\nA-1,organization,,customer"
const correctedCsv = "source_id,kind,name,role\nA-1,organization,Demo Customer,customer"
const batchPath = `/onboarding/imports/${batchId}`
const rejectedPath = `/onboarding/imports/${rejectedBatchId}`

const staged = {
  batch: {
    id: batchId,
    tenantId,
    sourceInstance,
    sourceVersion: null,
    objectKind: "party",
    fileChecksum: "a".repeat(64),
    mappingRevision: "party-csv-v1",
    uploadedBy: operatorId,
    status: "staged",
    rowCount: 1,
    rehearsal: null,
    rehearsedAt: null,
    appliedAt: null,
    createdAt: timestamp,
  },
  pending: 1,
  invalid: 0,
  applied: 0,
} satisfies ImportBatchSummary

const rejected = {
  ...staged,
  batch: { ...staged.batch, id: rejectedBatchId, fileChecksum: "b".repeat(64) },
  pending: 0,
  invalid: 1,
} satisfies ImportBatchSummary

const rehearsed = {
  ...staged,
  batch: {
    ...staged.batch,
    status: "rehearsed",
    rehearsal: {
      rows: 1,
      accepted: 1,
      alreadyMapped: 0,
      alreadyApplied: 0,
      blocking: 0,
      errors: [],
      durationMs: 15,
    },
    rehearsedAt: timestamp,
  },
} satisfies ImportBatchSummary

const applied = {
  summary: {
    ...rehearsed,
    batch: { ...rehearsed.batch, status: "applied", appliedAt: timestamp },
    pending: 0,
    applied: 1,
  },
  created: 1,
  linked: 0,
  changed: 0,
} satisfies ApplyImportResult

const rowError = {
  rowNumber: 2,
  sourceId: "",
  status: "invalid",
  nativeId: null,
  errors: [{ field: "name", code: "name_blank", message: "The name is required." }],
} satisfies ImportRow

const openImports = async (page: Page, url: string) => {
  await connectToTenant(page, url, "onboarding-session", tenantId, "My work")
  await page.getByRole("link", { name: "Data imports", exact: true }).click()
  await page.getByRole("heading", { name: "Data imports", exact: true }).waitFor()
}

const selectCsv = (page: Page, csv: string) =>
  page.getByLabel("CSV file").setInputFiles({
    name: "parties.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  })

const uploadPayload = (csv: string) => ({
  sourceInstance,
  objectKind: "party",
  mappingRevision: "party-csv-v1",
  csv,
})

it.effect(
  "carries the source through CSV correction, simulation, and keyboard apply",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      const uploads: unknown[] = []
      let summary: ImportBatchSummary = staged
      let applyCalls = 0

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          "POST /onboarding/imports": (route) => {
            uploads.push(route.request().postDataJSON())

            return fulfillJson(route, 201, {
              alreadyStaged: false,
              summary: uploads.length === 1 ? rejected : staged,
            })
          },
          [`GET ${rejectedPath}`]: (route) => fulfillJson(route, 200, rejected),
          [`GET ${rejectedPath}/rows`]: (route) => {
            const { searchParams } = new URL(route.request().url())
            assert.equal(searchParams.get("status"), "invalid")

            return fulfillJson(route, 200, [rowError])
          },
          [`GET ${batchPath}`]: (route) => fulfillJson(route, 200, summary),
          [`GET ${batchPath}/rows`]: (route) => fulfillJson(route, 200, []),
          [`POST ${batchPath}/rehearse`]: (route) => {
            summary = rehearsed

            return fulfillJson(route, 200, summary)
          },
          [`POST ${batchPath}/apply`]: (route) => {
            applyCalls += 1
            summary = applied.summary

            return fulfillJson(route, 200, applied)
          },
        })

        await openImports(page, url)
        await page.getByLabel("Source instance").fill(sourceInstance)
        await selectCsv(page, invalidCsv)
        await page.getByRole("button", { name: "Stage CSV", exact: true }).click()
        await page.waitForURL(`**/onboarding/${rejectedBatchId}`)
        await page.getByRole("heading", { name: "Row errors", exact: true }).waitFor()
        await page.getByText("name · The name is required.", { exact: true }).waitFor()
        assert.isFalse(await page.getByRole("button", { name: "Apply import" }).isEnabled())
        assert.equal(await page.getByLabel("Source instance").inputValue(), sourceInstance)

        await selectCsv(page, correctedCsv)
        await page.getByRole("button", { name: "Stage CSV", exact: true }).click()
        await page.waitForURL(`**/onboarding/${batchId}`)
        await page.getByRole("heading", { name: "Import batch", exact: true }).waitFor()
        await page.getByRole("button", { name: "Run simulation", exact: true }).press("Enter")
        await page.setViewportSize({ width: 640, height: 720 })

        const apply = page.getByRole("button", { name: "Apply import", exact: true })
        await apply.click({ trial: true })
        assert.equal(applyCalls, 0)
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )
        await apply.press("Enter")
        await page.getByText("Import applied.", { exact: true }).waitFor()

        assert.equal(applyCalls, 1)
        assert.deepEqual(uploads, [uploadPayload(invalidCsv), uploadPayload(correctedCsv)])
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)

it.effect(
  "reopens a saved batch, reloads an uncertain apply, and resumes",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      let applyCalls = 0
      let batchReads = 0

      yield* Effect.promise(async () => {
        await mockRoutes(page, {
          "POST /onboarding/imports": (route) =>
            fulfillJson(route, 409, conflictBody("ImportFileInvalid")),
          [`GET ${batchPath}`]: (route) => {
            batchReads += 1

            return fulfillJson(route, 200, applyCalls > 1 ? applied.summary : rehearsed)
          },
          [`GET ${batchPath}/rows`]: (route) => fulfillJson(route, 200, []),
          [`POST ${batchPath}/apply`]: (route) => {
            applyCalls += 1

            return applyCalls === 1 ? route.abort("failed") : fulfillJson(route, 200, applied)
          },
        })

        await openImports(page, url)
        await page.getByLabel("Source instance").fill(sourceInstance)
        await selectCsv(page, "source_id,kind\nA-1,organization")
        const stageButton = page.getByRole("button", { name: "Stage CSV", exact: true })
        await stageButton.click()
        await page.getByRole("alert").filter({ hasText: "required headers" }).waitFor()
        assert.equal(await page.getByLabel("Source instance").inputValue(), sourceInstance)

        await page.getByLabel("Batch ID").fill(batchId)
        await page.getByRole("button", { name: "Open batch", exact: true }).click()
        await page.waitForURL(`**/onboarding/${batchId}`)

        const apply = page.getByRole("button", { name: "Apply import", exact: true })
        await apply.click()

        const reload = page.getByRole("button", {
          name: "Reload batch before retrying",
          exact: true,
        })

        await reload.waitFor()
        assert.isFalse(await apply.isEnabled())
        const before = batchReads
        await reload.click()
        await reload.waitFor({ state: "hidden" })
        assert.isAbove(batchReads, before)

        await apply.click()
        await page.getByText("Import applied.", { exact: true }).waitFor()
        assert.equal(applyCalls, 2)
        assert.equal(new URL(page.url()).pathname, `/onboarding/${batchId}`)
      })

      assert.deepEqual(errors, [])
    }),
  { timeout: 120_000 },
)
