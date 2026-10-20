# ADR-0097: Move Product Identity to a Product Module

- Status: Accepted
- Date: 2026-10-20
- Amends: ADR-0035 (item identity moves out of Inventory)
- Compatible with: ADR-0015, ADR-0091, ADR-0094
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP parity plan, decision D1: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - Inventory primitives: [`./0035-define-p1-inventory-primitives.md`](./0035-define-p1-inventory-primitives.md)

## Context

ADR-0035 gave Inventory the item: SKU, name, and stock unit. Sales, Procurement, and Billing need to
sell and buy services and consumables that never hold stock, and they need one product reference
for prices, taxes, and invoice lines. Sales order lines already reference inventory items by id.

## Decision

1. **`erp/modules/product` owns product identity**: code (unique per tenant), name, type
   (`stockable`, `consumable`, `service`), optional category, unit of measure, and an active flag. It
   depends on no other ERP module.
2. **A stockable product's inventory item shares its identity.** Inventory registers the stock item
   for a stockable product with the product's id, SKU, name, and unit
   (`StockKeepingService.registerProductItem`), so existing `itemId` references on order and
   purchase lines stay valid and now name products. Inventory keeps stock-keeping facts only.
3. **Existing items become products.** A migration creates a stockable product for every existing
   inventory item with the same id. It reads `inventory.items` and writes only `product.products`.
4. **Other modules reference products by id.** Sales and Tax do not import the product module; a
   product id on their lines is validated by the command that needs product facts (for example the
   delivery and invoicing commands). This keeps the module graph acyclic, because Inventory depends
   on Accounting for valuation (ADR-0100) and Accounting depends on Sales.

## Consequences

- Inventory's legacy `createItem` still creates items without a product for the existing flows and
  tests; new flows create a product and register its item.
- Variants and attributes stay out until a pilot sells configurable goods.

## Alternatives Considered

- **Keep products in Inventory:** rejected; services and consumables have no stock.
- **Product creates the inventory item:** rejected; Product would depend on Inventory and the graph
  would cycle through Accounting and Sales.
