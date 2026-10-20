import * as Effect from "effect/Effect"
import type { Sql } from "postgres"

import { uuidv7 } from "../../framework/foundation/mod.ts"

export type ErpFixture = {
  readonly tenantId: string
  readonly organizationId: string
  readonly legalEntityId: string
  readonly periodId: string
}

/**
 * Seeds the minimum owner facts an ERP chain test needs: a tenant, an organization with a legal
 * entity configured for accounting, and an open accounting period. Tests use it only on a
 * disposable database created by `withTemporaryDatabase`.
 */
export const seedErpFixture = (
  client: Sql,
  options: { readonly periodStartsOn?: string; readonly periodEndsOn?: string } = {},
) =>
  Effect.promise(async (): Promise<ErpFixture> => {
    const [tenant] = await client<{ id: string }[]>`
      insert into auth.tenants (slug) values (${uuidv7()}) returning id
    `
    const legalEntity = await seedLegalEntity(client, tenant!.id, "Fixture Trading")
    const [period] = await client<{ id: string }[]>`
      insert into accounting.accounting_periods (tenant_id, legal_entity_id, starts_on, ends_on)
      values (${tenant!.id}, ${legalEntity.legalEntityId},
        ${options.periodStartsOn ?? "2026-01-01"}, ${options.periodEndsOn ?? "2026-12-31"})
      returning id
    `
    return { tenantId: tenant!.id, ...legalEntity, periodId: period!.id }
  })

export const seedLegalEntity = async (client: Sql, tenantId: string, name: string) => {
  const [organization] = await client<{ id: string }[]>`
    insert into party.parties (tenant_id, kind, name)
    values (${tenantId}, 'organization', ${name}) returning id
  `
  const [legalEntity] = await client<{ id: string }[]>`
    insert into party.legal_entities (tenant_id, organization_party_id)
    values (${tenantId}, ${organization!.id}) returning id
  `
  await client`
    insert into accounting.legal_entity_accounting_configurations
      (tenant_id, legal_entity_id, base_currency, decimal_precision, fiscal_year_start_month,
       posting_enabled)
    values (${tenantId}, ${legalEntity!.id}, 'IDR', 2, 1, true)
  `
  return { organizationId: organization!.id, legalEntityId: legalEntity!.id }
}

/** Grants every listed capability to one principal in one tenant. */
export const grantsFor = <const Capability extends string>(
  userAccountId: string,
  tenantId: string,
  capabilities: ReadonlyArray<Capability>,
) => capabilities.map((capability) => ({ userAccountId, tenantId, capability }))
