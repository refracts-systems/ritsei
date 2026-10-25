import * as Layer from "effect/Layer"
import type { Sql } from "postgres"

import {
  AccountingServiceLive as AccountingServiceLayer,
  FinancialOperationServiceLive,
  AccountingFiscalCalendarLive,
  GeneralLedgerLive,
} from "../modules/accounting/mod.ts"
import type { FinancialVerificationSignerService } from "../modules/accounting/mod.ts"
import { AuthLive as AuthServiceLayer } from "../../framework/modules/auth/mod.ts"
import { AuthorizationLive as AuthorizationServiceLayer } from "../../framework/modules/authorization/mod.ts"
import {
  IdentityEventPublisherLive,
  IdentityLive as IdentityServiceLayer,
} from "../../framework/modules/identity/mod.ts"
import {
  InventoryLive as InventoryServiceLayer,
  StockKeepingLive,
} from "../modules/inventory/mod.ts"
import { MessagingLive as MessagingServiceLayer } from "../../framework/modules/messaging/mod.ts"
import { NumberingLive } from "../../framework/modules/numbering/mod.ts"
import { ApprovalsLive } from "../../framework/modules/approvals/mod.ts"
import { CustomFieldsLive, customFieldPointsOf } from "../../framework/modules/custom-fields/mod.ts"
import { ErpModules } from "./modules.gen.ts"
import {
  PartyContactsLive,
  PartyEventPublisherLive,
  PartyLive as PartyServiceLayer,
} from "../modules/party/mod.ts"
import {
  OrderToCashLive,
  ProcessJobEnqueuerLive as ProcessJobEnqueuerServiceLayer,
  ProcessLive as ProcessServiceLayer,
  ProcessStudioLive,
} from "../modules/process/mod.ts"
import { ProcurementLive, PurchaseDocumentsLive } from "../modules/procurement/mod.ts"
import {
  SalesCustomerFieldsLive,
  SalesDocumentsLive,
  SalesLive as SalesServiceLayer,
} from "../modules/sales/mod.ts"
import {
  PostgresDatabaseLive,
  PostgresReadYourWritesLive,
  WebCryptoLive,
} from "../../framework/platform/mod.ts"
import {
  financialLedgerLayer,
  financialStoreObservationLayer,
} from "./adapters/financial-ledger.ts"
import { IdentityAccountAuthorizerLive } from "./adapters/identity-account-authorizer.ts"
import { identityProviderLayer } from "./authentication/oidc.ts"
import type { RitseiRuntimeConfiguration } from "./config.ts"
import { ProductFieldsLive, ProductLive } from "../modules/product/mod.ts"
import { TaxLive } from "../modules/tax/mod.ts"
import { BillingCreditExposureLive, BillingLive } from "../modules/billing/mod.ts"
import { SettlementLive } from "../modules/settlement/mod.ts"
import { DocumentsLive } from "../modules/documents/mod.ts"
import {
  IndonesianChartTemplatesLive,
  IndonesianIdentifierSchemesLive,
  LocalizationIdLive,
} from "../modules/localization_id/mod.ts"

export const serviceLayers = (
  client: Sql,
  configuration: RitseiRuntimeConfiguration,
  financialSigner?: Layer.Layer<FinancialVerificationSignerService>,
  replicaClient?: Sql,
) => {
  const DatabaseLive = PostgresDatabaseLive(client)

  const readYourWrites =
    configuration.postgresReadYourWrites !== undefined && replicaClient !== undefined
      ? PostgresReadYourWritesLive(client, replicaClient, configuration.postgresReadYourWrites)
      : Layer.empty

  const PlatformCore = Layer.merge(DatabaseLive, readYourWrites)
  const PlatformLive = Layer.mergeAll(PlatformCore, WebCryptoLive)
  const financialLedger = financialLedgerLayer(DatabaseLive)
  const financialObservation = financialStoreObservationLayer(DatabaseLive)

  const AuthorizationLive = AuthorizationServiceLayer.pipe(Layer.provide(DatabaseLive))

  const BusinessRequirements = Layer.mergeAll(PlatformCore, AuthorizationLive)

  const MessagingLive = MessagingServiceLayer.pipe(Layer.provide(DatabaseLive))

  const IdentityLive = IdentityServiceLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        DatabaseLive,
        IdentityAccountAuthorizerLive.pipe(Layer.provide(AuthorizationLive)),
        IdentityEventPublisherLive.pipe(Layer.provide(MessagingLive)),
      ),
    ),
  )

  const AuthLive = AuthServiceLayer.pipe(
    Layer.provide(Layer.mergeAll(PlatformLive, IdentityLive, identityProviderLayer(configuration))),
  )

  const PartyLive = PartyServiceLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        BusinessRequirements,
        PartyEventPublisherLive.pipe(Layer.provide(MessagingLive)),
        IndonesianIdentifierSchemesLive,
      ),
    ),
  )

  const PartyContactServiceLive = PartyContactsLive.pipe(Layer.provide(BusinessRequirements))

  const CreditExposureLive = BillingCreditExposureLive.pipe(Layer.provide(BusinessRequirements))

  const SalesLive = SalesServiceLayer.pipe(
    Layer.provide(Layer.mergeAll(BusinessRequirements, MessagingLive, CreditExposureLive)),
  )

  const InventoryLive = InventoryServiceLayer.pipe(
    Layer.provide(Layer.merge(BusinessRequirements, MessagingLive)),
  )

  const AccountingRequirements =
    financialSigner === undefined
      ? Layer.mergeAll(
          BusinessRequirements,
          MessagingLive,
          SalesLive,
          financialLedger,
          financialObservation,
        )
      : Layer.mergeAll(
          BusinessRequirements,
          MessagingLive,
          SalesLive,
          financialLedger,
          financialObservation,
          financialSigner,
        )

  const AccountingLive = AccountingServiceLayer.pipe(Layer.provide(AccountingRequirements))

  const NumberingServiceLive = NumberingLive.pipe(
    Layer.provide(
      Layer.merge(DatabaseLive, AccountingFiscalCalendarLive.pipe(Layer.provide(DatabaseLive))),
    ),
  )

  const LedgerLive = GeneralLedgerLive.pipe(
    Layer.provide(
      Layer.mergeAll(BusinessRequirements, NumberingServiceLive, IndonesianChartTemplatesLive),
    ),
  )

  const ProcessJobEnqueuerLive = ProcessJobEnqueuerServiceLayer.pipe(Layer.provide(DatabaseLive))

  const FinancialOperationsLive = FinancialOperationServiceLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        BusinessRequirements,
        MessagingLive,
        SalesLive,
        ProcessJobEnqueuerLive,
        financialLedger,
        financialObservation,
      ),
    ),
  )

  const ProcessLive = ProcessServiceLayer.pipe(
    Layer.provide(
      Layer.mergeAll(BusinessRequirements, SalesLive, InventoryLive, AccountingLive, MessagingLive),
    ),
  )

  const ProcessStudio = ProcessStudioLive.pipe(
    Layer.provide(Layer.merge(DatabaseLive, AuthorizationLive)),
  )

  const ApprovalServiceLive = ApprovalsLive.pipe(Layer.provide(BusinessRequirements))

  const ProcurementLiveWithRequirements = ProcurementLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        BusinessRequirements,
        PartyLive,
        InventoryLive,
        MessagingLive,
        ApprovalServiceLive,
      ),
    ),
  )

  const ProductServiceLive = ProductLive.pipe(Layer.provide(BusinessRequirements))

  // The document types whose modules released custom fields in their manifests (ADR-0109).
  const CustomFieldPointsLive = customFieldPointsOf(
    ErpModules.flatMap((manifest) =>
      (manifest.extensionPoints ?? []).flatMap((point) =>
        point.kind === "custom-fields" ? [point.documentType] : [],
      ),
    ),
  )

  const CustomFieldServiceLive = CustomFieldsLive.pipe(
    Layer.provide(Layer.merge(BusinessRequirements, CustomFieldPointsLive)),
  )

  const ProductFieldsServiceLive = ProductFieldsLive.pipe(
    Layer.provide(Layer.merge(BusinessRequirements, CustomFieldServiceLive)),
  )

  const SalesCustomerFieldsServiceLive = SalesCustomerFieldsLive.pipe(
    Layer.provide(Layer.merge(BusinessRequirements, CustomFieldServiceLive)),
  )

  const StockKeepingServiceLive = StockKeepingLive.pipe(
    Layer.provide(Layer.mergeAll(BusinessRequirements, LedgerLive, ProductServiceLive)),
  )

  const TaxServiceLive = TaxLive.pipe(Layer.provide(BusinessRequirements))

  const SalesDocumentServiceLive = SalesDocumentsLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        CreditExposureLive,
        BusinessRequirements,
        PartyLive,
        TaxServiceLive,
        NumberingServiceLive,
      ),
    ),
  )

  const PurchaseDocumentServiceLive = PurchaseDocumentsLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        BusinessRequirements,
        ApprovalServiceLive,
        NumberingServiceLive,
        PartyLive,
        ProductServiceLive,
        TaxServiceLive,
        StockKeepingServiceLive,
        ProcurementLiveWithRequirements,
      ),
    ),
  )

  const BillingServiceLive = BillingLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        BusinessRequirements,
        ApprovalServiceLive,
        PurchaseDocumentServiceLive,
        LedgerLive,
        NumberingServiceLive,
        TaxServiceLive,
        SalesDocumentServiceLive,
        ProductServiceLive,
      ),
    ),
  )

  const SettlementServiceLive = SettlementLive.pipe(
    Layer.provide(
      Layer.mergeAll(BusinessRequirements, LedgerLive, BillingServiceLive, NumberingServiceLive),
    ),
  )

  const LocalizationIdServiceLive = LocalizationIdLive.pipe(
    Layer.provide(Layer.mergeAll(BusinessRequirements, LedgerLive, TaxServiceLive)),
  )

  const DocumentsServiceLive = DocumentsLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        SalesLive,
        SalesDocumentServiceLive,
        ProcurementLiveWithRequirements,
        PurchaseDocumentServiceLive,
        BillingServiceLive,
        SettlementServiceLive,
      ),
    ),
  )

  const OrderToCashServiceLive = OrderToCashLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        BusinessRequirements,
        SalesDocumentServiceLive,
        StockKeepingServiceLive,
        ProductServiceLive,
      ),
    ),
  )

  const ApplicationLive = Layer.mergeAll(
    IdentityLive,
    AuthLive,
    AuthorizationLive,
    PartyLive,
    PartyContactServiceLive,
    SalesLive,
    InventoryLive,
    AccountingLive,
    LedgerLive,
    NumberingServiceLive,
    FinancialOperationsLive,
    ProcessJobEnqueuerLive,
    MessagingLive,
    ProcessLive,
    ProcessStudio,
    ProcurementLiveWithRequirements,
    ProductServiceLive,
    StockKeepingServiceLive,
    TaxServiceLive,
    SalesDocumentServiceLive,
    SalesCustomerFieldsServiceLive,
    ProductFieldsServiceLive,
    BillingServiceLive,
    SettlementServiceLive,
    DocumentsServiceLive,
    LocalizationIdServiceLive,
    ApprovalServiceLive,
    PurchaseDocumentServiceLive,
    OrderToCashServiceLive,
  )

  return ApplicationLive
}

export const makeApplicationLive = serviceLayers
