import { assert, it } from "@effect/vitest"

import { ReplicaConsistencyFailure } from "../../foundation/mod.ts"
import { ApiConflict, ApiForbidden, ApiNotFound, ApiServiceUnavailable } from "./api.ts"
import { toCoreApiError } from "./handlers.ts"

it("maps closed-world core failures to stable HTTP errors", () => {
  const forbidden = toCoreApiError({ _tag: "AuthorizationDenied" })
  assert.instanceOf(forbidden, ApiForbidden)

  const notFound = toCoreApiError({ _tag: "SalesOrderNotFound" })
  assert.instanceOf(notFound, ApiNotFound)
  assert.strictEqual(notFound.code, "SalesOrderNotFound")

  const conflict = toCoreApiError({ _tag: "StockUnavailable" })
  assert.instanceOf(conflict, ApiConflict)
  assert.strictEqual(conflict.code, "StockUnavailable")

  const procurementNotFound = toCoreApiError({ _tag: "PurchaseOrderNotFound" })
  assert.instanceOf(procurementNotFound, ApiNotFound)
  assert.strictEqual(procurementNotFound.code, "PurchaseOrderNotFound")

  const procurementConflict = toCoreApiError({ _tag: "PurchaseReceiptQuantityExceeded" })
  assert.instanceOf(procurementConflict, ApiConflict)
  assert.strictEqual(procurementConflict.code, "PurchaseReceiptQuantityExceeded")

  const stagingEvidenceConflict = toCoreApiError({ _tag: "FinancialStagingEvidenceConflict" })
  assert.instanceOf(stagingEvidenceConflict, ApiConflict)
  assert.strictEqual(stagingEvidenceConflict.code, "FinancialStagingEvidenceConflict")

  const stagingEvidenceInvalid = toCoreApiError({ _tag: "FinancialStagingEvidenceInvalid" })
  assert.instanceOf(stagingEvidenceInvalid, ApiConflict)
  assert.strictEqual(stagingEvidenceInvalid.code, "FinancialStagingEvidenceInvalid")

  const invalidRequest = toCoreApiError({ _tag: "SchemaError" })
  assert.instanceOf(invalidRequest, ApiConflict)
  assert.strictEqual(invalidRequest.code, "invalid_request")

  const unavailable = toCoreApiError({ _tag: "DatabaseFailure" })
  assert.instanceOf(unavailable, ApiServiceUnavailable)

  const replicaUnavailable = toCoreApiError(new ReplicaConsistencyFailure({ reason: "timeout" }))
  assert.instanceOf(replicaUnavailable, ApiServiceUnavailable)

  const invalidReplicaToken = toCoreApiError(
    new ReplicaConsistencyFailure({ reason: "tenant_mismatch" }),
  )
  assert.instanceOf(invalidReplicaToken, ApiConflict)
  assert.strictEqual(invalidReplicaToken.code, "invalid_consistency_token")
})
