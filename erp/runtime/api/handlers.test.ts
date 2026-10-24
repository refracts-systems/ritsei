import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { DatabaseFailure, ReplicaConsistencyFailure } from "../../../framework/foundation/mod.ts"
import { AuthorizationDenied } from "../../../framework/modules/authorization/mod.ts"
import { ApiConflict, ApiForbidden, ApiNotFound, ApiServiceUnavailable } from "./api.ts"
import { AccountingHttpErrors } from "../../modules/accounting/http.ts"
import {
  FinancialStagingEvidenceConflict,
  FinancialStagingEvidenceInvalid,
} from "../../modules/accounting/mod.ts"
import { InventoryHttpErrors } from "../../modules/inventory/http.ts"
import { StockUnavailable } from "../../modules/inventory/mod.ts"
import { ProcurementHttpErrors } from "../../modules/procurement/http.ts"
import {
  PurchaseOrderNotFound,
  PurchaseReceiptQuantityExceeded,
} from "../../modules/procurement/mod.ts"
import { SalesHttpErrors } from "../../modules/sales/http.ts"
import { SalesOrderNotFound } from "../../modules/sales/mod.ts"
import { toCoreApiError } from "./handlers.ts"

const tenantId = "018f0000-0000-7000-8000-000000000001"
const entityId = "018f0000-0000-7000-8000-000000000002"

it.effect("maps framework and module failures to stable HTTP errors", () =>
  Effect.gen(function* () {
    const forbidden = toCoreApiError(
      new AuthorizationDenied({ tenantId, capability: "party.branch.create" }),
    )

    assert.instanceOf(forbidden, ApiForbidden)

    const notFound = SalesHttpErrors.toApiError(
      new SalesOrderNotFound({ tenantId, orderId: entityId }),
    )

    assert.instanceOf(notFound, ApiNotFound)
    assert.strictEqual(notFound.code, "SalesOrderNotFound")

    const conflict = InventoryHttpErrors.toApiError(
      new StockUnavailable({ tenantId, warehouseId: entityId, itemId: entityId, requested: "1" }),
    )

    assert.instanceOf(conflict, ApiConflict)
    assert.strictEqual(conflict.code, "StockUnavailable")

    const procurementNotFound = ProcurementHttpErrors.toApiError(
      new PurchaseOrderNotFound({ tenantId, purchaseOrderId: entityId }),
    )

    assert.instanceOf(procurementNotFound, ApiNotFound)
    assert.strictEqual(procurementNotFound.code, "PurchaseOrderNotFound")

    const procurementConflict = ProcurementHttpErrors.toApiError(
      new PurchaseReceiptQuantityExceeded({
        tenantId,
        purchaseOrderId: entityId,
        purchaseOrderLineId: entityId,
        ordered: "1",
        received: "1",
        requested: "1",
      }),
    )

    assert.instanceOf(procurementConflict, ApiConflict)
    assert.strictEqual(procurementConflict.code, "PurchaseReceiptQuantityExceeded")

    const stagingEvidenceConflict = AccountingHttpErrors.toApiError(
      new FinancialStagingEvidenceConflict({
        tenantId,
        recordId: entityId,
        reason: "different_content",
      }),
    )

    assert.instanceOf(stagingEvidenceConflict, ApiConflict)
    assert.strictEqual(stagingEvidenceConflict.code, "FinancialStagingEvidenceConflict")

    const stagingEvidenceInvalid = AccountingHttpErrors.toApiError(
      new FinancialStagingEvidenceInvalid({
        tenantId,
        recordId: entityId,
        reason: "hash_mismatch",
      }),
    )

    assert.instanceOf(stagingEvidenceInvalid, ApiConflict)
    assert.strictEqual(stagingEvidenceInvalid.code, "FinancialStagingEvidenceInvalid")

    const invalidRequest = toCoreApiError(
      yield* Effect.flip(Schema.decodeUnknownEffect(Schema.String)(1)),
    )

    assert.instanceOf(invalidRequest, ApiConflict)
    assert.strictEqual(invalidRequest.code, "invalid_request")

    const unavailable = toCoreApiError(new DatabaseFailure({ operation: "test", cause: undefined }))
    assert.instanceOf(unavailable, ApiServiceUnavailable)

    const replicaUnavailable = toCoreApiError(new ReplicaConsistencyFailure({ reason: "timeout" }))
    assert.instanceOf(replicaUnavailable, ApiServiceUnavailable)

    const invalidReplicaToken = toCoreApiError(
      new ReplicaConsistencyFailure({ reason: "tenant_mismatch" }),
    )

    assert.instanceOf(invalidReplicaToken, ApiConflict)
    assert.strictEqual(invalidReplicaToken.code, "invalid_consistency_token")
  }),
)
