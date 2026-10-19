import * as Layer from "effect/Layer"

import { ProcurementService } from "./contract.ts"
import { makeProcurementService, makeProcurementTestLayer } from "./service.ts"

export const ProcurementLive = Layer.effect(ProcurementService, makeProcurementService)

export { makeProcurementService, makeProcurementTestLayer }
