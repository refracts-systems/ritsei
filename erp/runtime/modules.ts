import type { ModuleManifest } from "../../framework/modules/module/mod.ts"
import { AccountingModule } from "../modules/accounting/mod.ts"
import { BillingModule } from "../modules/billing/mod.ts"
import { CommunicationModule } from "../modules/communication/mod.ts"
import { InventoryModule } from "../modules/inventory/mod.ts"
import { PartyModule } from "../modules/party/mod.ts"
import { ProcessModule } from "../modules/process/mod.ts"
import { ProcurementModule } from "../modules/procurement/mod.ts"
import { SalesModule } from "../modules/sales/mod.ts"

/** The installed ERP modules (ADR-0094); `ritsei new module` appends to this list. */
export const ErpModules: ReadonlyArray<ModuleManifest> = [
  PartyModule,
  SalesModule,
  InventoryModule,
  ProcurementModule,
  AccountingModule,
  BillingModule,
  CommunicationModule,
  ProcessModule,
]
