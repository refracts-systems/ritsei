import * as Layer from "effect/Layer"
import type { Sql } from "postgres"

import { DurableJobEnqueuer } from "../../framework/foundation/mod.ts"
import {
  AccountingService,
  FinancialOperationServiceLive,
  GeneralLedgerLive,
  makeAccountingService,
} from "../modules/accounting/mod.ts"
import type { FinancialVerificationSignerService } from "../modules/accounting/mod.ts"
import { AuthService, makeAuthService } from "../../framework/modules/auth/mod.ts"
import {
  AuthorizationService,
  makeAuthorizationService,
} from "../../framework/modules/authorization/mod.ts"
import {
  IdentityEventPublisherLive,
  makeUserAccountService,
  UserAccountService,
} from "../../framework/modules/identity/mod.ts"
import { InventoryService, makeInventoryService } from "../modules/inventory/mod.ts"
import { makeMessagingService, MessagingService } from "../../framework/modules/messaging/mod.ts"
import { NumberingLive } from "../../framework/modules/numbering/mod.ts"
import {
  makePartyService,
  PartyContactsLive,
  PartyEventPublisherLive,
  PartyService,
} from "../modules/party/mod.ts"
import {
  makeProcessJobEnqueuer,
  makeProcessService,
  ProcessService,
  ProcessStudioLive,
} from "../modules/process/mod.ts"
import { ProcurementLive } from "../modules/procurement/mod.ts"
import { makeSalesService, SalesService } from "../modules/sales/mod.ts"
import {
  PostgresDatabaseLive,
  PostgresReadYourWritesLive,
  WebCryptoLive,
} from "../../framework/platform/mod.ts"
import {
  makeFinancialLedgerLayer,
  makeFinancialStoreObservationLayer,
} from "./adapters/financial-ledger.ts"
import { IdentityAccountAuthorizerLive } from "./adapters/identity-account-authorizer.ts"
import { makeIdentityProviderLayer } from "./authentication/oidc.ts"
import type { RitseiRuntimeConfiguration } from "./config.ts"
import { ProductLive } from "../modules/product/mod.ts"

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
  const financialLedger = makeFinancialLedgerLayer(DatabaseLive)
  const financialObservation = makeFinancialStoreObservationLayer(DatabaseLive)

  const AuthorizationLive = Layer.effect(AuthorizationService, makeAuthorizationService).pipe(
    Layer.provide(DatabaseLive),
  )

  const BusinessRequirements = Layer.mergeAll(PlatformCore, AuthorizationLive)

  const MessagingLive = Layer.effect(MessagingService, makeMessagingService).pipe(
    Layer.provide(DatabaseLive),
  )

  const IdentityLive = Layer.effect(UserAccountService, makeUserAccountService).pipe(
    Layer.provide(
      Layer.mergeAll(
        DatabaseLive,
        IdentityAccountAuthorizerLive.pipe(Layer.provide(AuthorizationLive)),
        IdentityEventPublisherLive.pipe(Layer.provide(MessagingLive)),
      ),
    ),
  )

  const AuthLive = Layer.effect(AuthService, makeAuthService).pipe(
    Layer.provide(
      Layer.mergeAll(PlatformLive, IdentityLive, makeIdentityProviderLayer(configuration)),
    ),
  )

  const PartyLive = Layer.effect(PartyService, makePartyService).pipe(
    Layer.provide(
      Layer.merge(BusinessRequirements, PartyEventPublisherLive.pipe(Layer.provide(MessagingLive))),
    ),
  )

  const PartyContactServiceLive = PartyContactsLive.pipe(Layer.provide(BusinessRequirements))

  const SalesLive = Layer.effect(SalesService, makeSalesService).pipe(
    Layer.provide(Layer.merge(BusinessRequirements, MessagingLive)),
  )

  const InventoryLive = Layer.effect(InventoryService, makeInventoryService).pipe(
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
  const AccountingLive = Layer.effect(AccountingService, makeAccountingService).pipe(
    Layer.provide(AccountingRequirements),
  )

  const NumberingServiceLive = NumberingLive.pipe(Layer.provide(DatabaseLive))

  const LedgerLive = GeneralLedgerLive.pipe(
    Layer.provide(Layer.merge(BusinessRequirements, NumberingServiceLive)),
  )

  const ProcessJobEnqueuerLive = Layer.effect(DurableJobEnqueuer, makeProcessJobEnqueuer).pipe(
    Layer.provide(DatabaseLive),
  )

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

  const ProcessLive = Layer.effect(ProcessService, makeProcessService).pipe(
    Layer.provide(
      Layer.mergeAll(BusinessRequirements, SalesLive, InventoryLive, AccountingLive, MessagingLive),
    ),
  )

  const ProcessStudio = ProcessStudioLive.pipe(
    Layer.provide(Layer.merge(DatabaseLive, AuthorizationLive)),
  )

  const ProcurementLiveWithRequirements = ProcurementLive.pipe(
    Layer.provide(Layer.mergeAll(BusinessRequirements, PartyLive, InventoryLive, MessagingLive)),
  )

  const ProductServiceLive = ProductLive.pipe(Layer.provide(BusinessRequirements))

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
  )

  return ApplicationLive
}

export const makeApplicationLive = serviceLayers
