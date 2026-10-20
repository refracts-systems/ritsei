import type { TenantMembership, TenantMembershipStatus } from "./contract.ts"

export type MembershipRow = {
  readonly userAccountId: string
  readonly tenantId: string
  readonly status: TenantMembershipStatus
}

export const membershipKey = (userAccountId: string, tenantId: string) =>
  `${userAccountId}:${tenantId}`

export const toTenantMembership = (row: MembershipRow): TenantMembership => ({
  userAccountId: row.userAccountId,
  tenantId: row.tenantId,
  status: row.status,
})
