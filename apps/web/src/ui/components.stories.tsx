import { createSignal } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { layout } from "./foundations/layout.ts"
import { projectVisualIntent } from "./grammar/projection.ts"
import { FieldArray } from "./internal/field-array.tsx"
import { ApprovalComposition } from "./patterns/approval-composition.tsx"
import { Approval } from "./patterns/approval.tsx"
import { BulkOperation } from "./patterns/bulk-operation.tsx"
import { CommandSurface } from "./patterns/command-surface.tsx"
import { DataTable } from "./patterns/data-table.tsx"
import { EntityWorkspace } from "./patterns/entity-workspace.tsx"
import { ExceptionInvestigation } from "./patterns/exception-investigation.tsx"
import { FilterBar } from "./patterns/filter-bar.tsx"
import { MasterDetail } from "./patterns/master-detail.tsx"
import { OperationalWorkspace } from "./patterns/operational-workspace.tsx"
import { RitseiVirtualList } from "./patterns/ritsei-virtual-list.tsx"
import { Settings } from "./patterns/settings.tsx"
import { Badge } from "./primitives/badge.tsx"
import { Button } from "./primitives/button.tsx"
import { Dialog } from "./primitives/dialog.tsx"
import { FormField } from "./primitives/form-field.tsx"
import { Form } from "./primitives/form.tsx"
import { Input } from "./primitives/input.tsx"
import { MoneyField } from "./primitives/money-field.tsx"
import { PartyField } from "./primitives/party-field.tsx"
import { QuantityField } from "./primitives/quantity-field.tsx"
import { Select } from "./primitives/select.tsx"
import { Tabs } from "./primitives/tabs.tsx"
import { surface } from "./recipes/surface.ts"
import { CartographyField } from "./renderers/cartography/cartography-field.tsx"

const rows = [
  { id: "PO-001", supplier: "Aster Supplies", status: "Draft" },
  { id: "PO-002", supplier: "Northwind Parts", status: "Approved" },
]

const visualIntent = projectVisualIntent({
  variationKey: "storybook.purchase-order-flow",
  archetypes: ["flow", "capacity"],
  primitives: ["field", "contour", "route", "marker", "boundary"],
  dimension: "movement",
  value: 0.72,
  semantics: {
    label: "Purchase order movement",
    description: "A renderer-neutral visual summary; the table remains authoritative.",
  },
  fallback: {
    summary: "Two purchase orders are moving through the receiving workflow.",
    metrics: [
      { label: "In transit", value: "2" },
      { label: "Route activity", value: "72%" },
    ],
  },
  motion: "active",
  markers: [{ id: "receiving", label: "Receiving: 2 orders", x: 68, y: 58, tone: "info" }],
})

function ComponentsStory() {
  const [lines, setLines] = createSignal(["First field"])
  const [selectedMarker, setSelectedMarker] = createSignal<string>()
  return (
    <main class={layout.main}>
      <div class={layout.stack}>
        <header class={layout.stack}>
          <p class={layout.notice}>RITSEI semantic UI</p>
          <h1>Core components and product patterns</h1>
          <p>Semantic contracts stay independent from engine-specific APIs.</p>
        </header>

        <section class={[surface(), layout.stack]} aria-labelledby="controls-heading">
          <h2 id="controls-heading">Controls</h2>
          <div class={layout.row}>
            <Badge tone="success">Approved</Badge>
            <Input aria-label="Search" placeholder="Search records" />
            <Select
              aria-label="Status"
              options={[
                { value: "draft", label: "Draft" },
                {
                  value: "approved",
                  label: "Approved",
                },
              ]}
              placeholder="Status"
            />
            <Dialog
              title="Confirm action"
              description="This dialog owns the accessible modal boundary."
              trigger="Open dialog"
              footer={
                <Button variant="secondary" type="button">
                  Cancel
                </Button>
              }
            >
              <p>Dialog content is supplied by the caller.</p>
            </Dialog>
          </div>
          <Tabs
            items={[
              { value: "summary", label: "Summary", content: <p>Summary content.</p> },
              { value: "history", label: "History", content: <p>History content.</p> },
            ]}
          />
        </section>

        <section class={[surface(), layout.stack]} aria-labelledby="fields-heading">
          <h2 id="fields-heading">Semantic fields</h2>
          <Form onSubmit={(value) => console.info(value)}>
            <FormField
              label="Reference"
              helperText="Use the business reference, not a database identifier."
            >
              {(props) => <Input {...props} name="reference" />}
            </FormField>
            <MoneyField label="Amount" name="amount" placeholder="0.00" />
            <QuantityField label="Quantity" name="quantity" min="0" step="0.01" />
            <PartyField
              label="Supplier"
              name="supplier"
              options={[
                { value: "aster", label: "Aster Supplies" },
                {
                  value: "northwind",
                  label: "Northwind Parts",
                },
              ]}
              placeholder="Choose supplier"
            />
            <FieldArray
              items={lines()}
              onChange={(next) => setLines([...next])}
              createItem={() => "New field"}
              renderItem={(item) => <Input aria-label="Repeatable field" value={item} />}
            />
            <Button type="submit" variant="primary">
              Save
            </Button>
          </Form>
        </section>

        <section class={[surface(), layout.stack]} aria-labelledby="grammar-heading">
          <h2 id="grammar-heading">Visual grammar</h2>
          <CartographyField
            intent={visualIntent}
            selectedMarkerId={selectedMarker()}
            onInteraction={(interaction) => {
              if (interaction.type === "select") setSelectedMarker(interaction.targetId)
            }}
          />
        </section>

        <DataTable
          caption="Purchase orders"
          rows={rows}
          getRowId={(row) => row.id}
          columns={[
            { id: "id", header: "Reference", cell: (row) => row.id },
            { id: "supplier", header: "Supplier", cell: (row) => row.supplier },
            { id: "status", header: "Status", cell: (row) => <Badge>{row.status}</Badge> },
          ]}
        />

        <RitseiVirtualList
          ariaLabel="Purchase order list"
          items={rows}
          itemHeight={48}
          getItemId={(row) => row.id}
          renderItem={(row) => (
            <span>
              {row.id} · {row.supplier}
            </span>
          )}
        />

        <FilterBar
          actions={
            <Button type="submit" variant="primary">
              Apply
            </Button>
          }
        >
          <Input name="query" aria-label="Query" placeholder="Filter records" />
        </FilterBar>

        <CommandSurface label="Record commands">
          <Button type="button" variant="primary">
            Create
          </Button>
          <Button type="button" variant="secondary">
            Refresh
          </Button>
        </CommandSurface>

        <MasterDetail
          master={
            <ul>
              <li>Purchase order PO-001</li>
              <li>Purchase order PO-002</li>
            </ul>
          }
          detail={<p>Selected purchase order details.</p>}
        />

        <EntityWorkspace
          title="Purchase order"
          description={<p>Review the current document and its related information.</p>}
          headerActions={
            <Button type="button" variant="secondary">
              Edit
            </Button>
          }
          toolbar={
            <FilterBar>
              <Input aria-label="Workspace filter" placeholder="Filter lines" />
            </FilterBar>
          }
          aside={<p>Supplier summary</p>}
        >
          <DataTable
            caption="Lines"
            rows={rows}
            columns={[{ id: "id", header: "Reference", cell: (row) => row.id }]}
          />
        </EntityWorkspace>

        <OperationalWorkspace
          title="Receiving queue"
          description={<p>Work items requiring operator attention.</p>}
          status={<span>All systems operational</span>}
          actions={
            <Button type="button" variant="primary">
              Refresh
            </Button>
          }
          secondary={<p>Queue policy and recent activity.</p>}
        >
          <p>Two receipts are ready for review.</p>
        </OperationalWorkspace>

        <Settings
          title="Workspace settings"
          description={<p>Configure the current operator workspace.</p>}
          actions={
            <Button type="button" variant="primary">
              Save settings
            </Button>
          }
        >
          <FormField label="Workspace name">
            <Input name="workspace" />
          </FormField>
        </Settings>

        <Approval
          title="Approve purchase order"
          description={
            <p>Approval is a business action; authorization remains outside this component.</p>
          }
          approveLabel="Approve"
          rejectLabel="Reject"
          onApprove={() => undefined}
          onReject={() => undefined}
          status="Awaiting decision"
        >
          <p>PO-001 · Aster Supplies</p>
        </Approval>

        <ApprovalComposition
          title="Approval composition"
          description={<p>Content and actions are caller-owned slots.</p>}
          content={<p>Approval content.</p>}
          actions={
            <Button type="button" variant="primary">
              Continue
            </Button>
          }
        />

        <BulkOperation
          title="Bulk archive"
          description={<p>Review selected records before submitting the command.</p>}
          selectedCount={2}
          actions={
            <Button type="button" variant="danger">
              Archive selected
            </Button>
          }
        >
          <p>Two records selected.</p>
        </BulkOperation>

        <ExceptionInvestigation
          title="Investigate exception"
          description={<p>Trace the failed operation and choose a safe next action.</p>}
          actions={
            <Button type="button" variant="secondary">
              Open log
            </Button>
          }
          evidence={<pre>{'{"status":"timeout"}'}</pre>}
        >
          <p>The supplier lookup timed out.</p>
        </ExceptionInvestigation>
      </div>
    </main>
  )
}

const meta = {
  title: "UI/Components",
  component: ComponentsStory,
} satisfies Meta<typeof ComponentsStory>

export default meta
type Story = StoryObj<typeof meta>

export const Overview: Story = {}
