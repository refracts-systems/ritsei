# Frontend Capability Coverage

> **Status:** Repository-local record, compacted. **Related:** [`../roadmap/frontend.md`](../roadmap/frontend.md)
> · [`../architecture/authorization.md`](../architecture/authorization.md)

Every workspace uses generated Effect Schema contracts, bearer authentication, an explicit tenant
header, backend authorization, bounded reads, and non-optimistic mutations. The browser never imports
persistence, grants capabilities, or becomes authoritative for business facts. Commands appear only
where a public backend command exists; coverage lives in `tests/frontend/`.

| Route | Workspace |
|---|---|
| `/user-accounts` | Tenant-filtered accounts: list, detail, create, email update |
| `/parties` | Search, detail, create, roles, identifiers, legal entities, branches, relationships |
| `/access` | Memberships and lifecycle, capability catalog, direct grants |
| `/procurement` | Supplier accounts, purchase orders, receipts |
| `/inventory` | Warehouses, items, stock, reservations, transfers, movements |
| `/sales` | Customers, quotations, orders, confirmation and cancellation |
| `/accounting` | Legal entity configuration, accounts, periods, revenue profiles, journals |
| `/processes` | Typed catalog, draft editing, validation, monitoring, operator recovery |
