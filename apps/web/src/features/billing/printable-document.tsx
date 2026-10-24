import { For, Show } from "solid-js"
import type { Names } from "../../shared/party-names.ts"
import { formatDecimal } from "../../ui/foundations/format.ts"
import { layout } from "../../ui/foundations/layout.ts"
import type { BillingDocument } from "./service.ts"

const titles: Record<BillingDocument["kind"], string> = {
  customer_invoice: "Invoice",
  customer_credit_note: "Credit note",
  supplier_bill: "Supplier bill",
  supplier_credit_note: "Supplier credit note",
}

/**
 * The document as it prints: who issued it, who it is for, its lines and totals. It is hidden on
 * screen and is the only thing the browser prints, so "Print" can also save it as a PDF without a
 * rendering service. The issuer and the other party swap for supplier documents.
 */
export function PrintableDocument(props: { document: BillingDocument; names: Names }) {
  const issuedByUs = () => props.document.kind.startsWith("customer")
  const us = () => props.names.legalEntities.get(props.document.legalEntityId) ?? "Your company"
  const them = () => props.names.parties.get(props.document.partyId) ?? props.document.partyId

  return (
    <section data-print-sheet="" aria-label="Printable document">
      <h1>
        {titles[props.document.kind]} {props.document.number}
      </h1>
      <dl class={layout.detailList}>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>From</dt>
          <dd class={layout.detailValue}>{issuedByUs() ? us() : them()}</dd>
        </div>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>To</dt>
          <dd class={layout.detailValue}>{issuedByUs() ? them() : us()}</dd>
        </div>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>Date</dt>
          <dd class={layout.detailValue}>{props.document.invoiceDate}</dd>
        </div>
        <Show when={props.document.supplierReference}>
          {(reference) => (
            <div class={layout.detailItem}>
              <dt class={layout.detailTerm}>Supplier reference</dt>
              <dd class={layout.detailValue}>{reference()}</dd>
            </div>
          )}
        </Show>
      </dl>
      <table>
        <thead>
          <tr>
            <th scope="col">Description</th>
            <th scope="col">Quantity</th>
            <th scope="col">Unit price</th>
            <th scope="col">Net</th>
            <th scope="col">Tax</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.document.lines}>
            {(line) => (
              <tr>
                <th scope="row">{line.description}</th>
                <td class={layout.numeric}>{line.quantity}</td>
                <td class={layout.numeric}>{formatDecimal(line.unitPrice)}</td>
                <td class={layout.numeric}>{formatDecimal(line.netAmount)}</td>
                <td class={layout.numeric}>{formatDecimal(line.taxAmount)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <dl class={layout.detailList}>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>Subtotal</dt>
          <dd class={[layout.detailValue, layout.numeric]}>
            {formatDecimal(props.document.subtotal)}
          </dd>
        </div>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>Tax</dt>
          <dd class={[layout.detailValue, layout.numeric]}>
            {formatDecimal(props.document.taxTotal)}
          </dd>
        </div>
        <div class={layout.detailItem}>
          <dt class={layout.detailTerm}>Total</dt>
          <dd class={[layout.detailValue, layout.numeric]}>
            <strong>{formatDecimal(props.document.total)}</strong>
          </dd>
        </div>
      </dl>
    </section>
  )
}
