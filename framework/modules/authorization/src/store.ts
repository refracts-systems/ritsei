import type { TenantMembership, TenantMembershipStatus } from "./contract.ts"

export type MembershipRow = {
  readonly userAccountId: string
  readonly tenantId: string
  readonly status: string
}

export const membershipKey = (userAccountId: string, tenantId: string) =>
  `${userAccountId}:${tenantId}`

export const toTenantMembership = (row: MembershipRow): TenantMembership => ({
  userAccountId: row.userAccountId,
  tenantId: row.tenantId,
  // SAFETY: tenant_memberships_status_check limits the column to the status union.
  status: row.status as TenantMembershipStatus,
})
