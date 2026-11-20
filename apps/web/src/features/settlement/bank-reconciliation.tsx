import { useMutation } from "@tanstack/solid-query"
import { createSignal, For, Show, useContext } from "solid-js"
import { createAccountsQuery } from "../accounting/queries.ts"
import type { RequestFailure } from "../../shared/api.ts"
import { formText } from "../../shared/form-values.ts"
import { CommandFeedback, QueryBoundary, reloaded } from "../../shared/request-feedback.tsx"
import { ApiRuntime, runRequest } from "../../shared/runtime.ts"
import { createServerQuery } from "../../shared/server-query.ts"
import { layout } from "../../ui/foundations/layout.ts"
import { Button } from "../../ui/primitives/button.tsx"
import { FormField } from "../../ui/primitives/form-field.tsx"
import { Form, type FormValue } from "../../ui/primitives/form.tsx"
import { Input } from "../../ui/primitives/input.tsx"
import { MoneyField } from "../../ui/primitives/money-field.tsx"
import { Select } from "../../ui/primitives/select.tsx"
import { surface } from "../../ui/recipes/surface.ts"
import {
  bankFailureMessages,
  getBankReconciliation,
  importStatement,
  matchLine,
  reverseMatch,
  type BankReconciliation,
  type BankMatch,
  type ImportedStatement,
} from "./bank-service.ts"

async function statementFile(value: FormValue, legalEntityId: string, bankAccountId: string) {
  const file = value.statement

  if (!(file instanceof File) || file.size > 1_048_576) return undefined

  const content = await file.text()
  const input = { legalEntityId, bankAccountId, sourceName: file.name, content }

  return new TextEncoder().encode(JSON.stringify(input)).byteLength > 1_048_576 ? undefined : input
}

function BankActions(props: {
  legalEntityId: string
  bankAccountId: string
  data: BankReconciliation
  reload: () => Promise<void>
}) {
  const scope = useContext(ApiRuntime)
  const [invalidFile, setInvalidFile] = createSignal(false)

  const importMutation = useMutation<
    ImportedStatement,
    RequestFailure,
    Parameters<typeof importStatement>[0]
  >(() => ({
    mutationFn: (input: Parameters<typeof importStatement>[0]) =>
      runRequest(scope, importStatement(input)),
    onSuccess: props.reload,
  }))

  const matchMutation = useMutation<BankMatch, RequestFailure, Parameters<typeof matchLine>[0]>(
    () => ({
      mutationFn: (input: Parameters<typeof matchLine>[0]) => runRequest(scope, matchLine(input)),
      onSuccess: props.reload,
    }),
  )

  const reverseMutation = useMutation<BankMatch, RequestFailure, string>(() => ({
    mutationFn: (id: string) => runRequest(scope, reverseMatch(id)),
    onSuccess: props.reload,
  }))

  return (
    <>
      <Form
        class={layout.stack}
        aria-label="Import bank statement"
        onSubmit={async (value) => {
          const input = await statementFile(value, props.legalEntityId, props.bankAccountId)

          if (input === undefined) {
            setInvalidFile(true)

            return
          }

          setInvalidFile(false)
          importMutation.mutate(input)
        }}
      >
        <p>
          CSV columns must be date, description, reference, amount. Use YYYY-MM-DD dates and signed
          decimal amounts.
        </p>
        <FormField
          label="Bank statement CSV"
          required
          error={
            invalidFile()
              ? "Choose a nonempty CSV file that fits within the 1 MiB request limit."
              : undefined
          }
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="statement"
              type="file"
              accept=".csv,text/csv"
              required
              disabled={importMutation.isPending}
            />
          )}
        </FormField>
        <CommandFeedback
          error={importMutation.error}
          messages={bankFailureMessages}
          pending={importMutation.isPending}
          success={importMutation.isSuccess}
          successMessage="Statement imported."
          reload={props.reload}
          reset={() => importMutation.reset()}
        />
        <Button type="submit" loading={importMutation.isPending}>
          Import statement
        </Button>
      </Form>
      <h3>Unmatched statement lines</h3>
      <Show
        when={props.data.lines.length > 0}
        fallback={<p role="status">No unmatched statement lines.</p>}
      >
        <ul>
          <For each={props.data.lines}>
            {(line) => (
              <li class={layout.detailValue}>
                {line.sourceName}, line {line.lineNumber} · {line.bookingDate} · {line.description}{" "}
                · {line.reference ?? "No reference"} · {line.amount} · Remaining{" "}
                {line.unmatchedAmount} · Statement {line.statementId}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <h3>Unmatched payments</h3>
      <Show
        when={props.data.payments.length > 0}
        fallback={<p role="status">No unmatched payments on this account.</p>}
      >
        <ul>
          <For each={props.data.payments}>
            {(payment) => (
              <li class={layout.detailValue}>
                {payment.paymentDate} · {payment.number} · {payment.direction} · Remaining{" "}
                {payment.unmatchedCash}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.data.lines.length > 0 && props.data.payments.length > 0}>
        <Form
          class={layout.stack}
          aria-label="Match bank line"
          onSubmit={(value) => {
            if (matchMutation.isPending || matchMutation.error?.kind === "unknown-outcome") return
            matchMutation.mutate({
              lineId: formText(value.lineId),
              paymentId: formText(value.paymentId),
              amount: formText(value.amount),
            })
          }}
        >
          <FormField label="Statement line" required>
            {(fieldProps) => (
              <Select
                {...fieldProps}
                name="lineId"
                placeholder="Choose a line"
                required
                options={props.data.lines.map((line) => ({
                  value: line.id,
                  label: `${line.sourceName} · line ${line.lineNumber} · ${line.bookingDate} · ${line.description} · ${line.reference ?? "No reference"} · ${line.statementId}`,
                }))}
              />
            )}
          </FormField>
          <FormField label="Payment" required>
            {(fieldProps) => (
              <Select
                {...fieldProps}
                name="paymentId"
                placeholder="Choose a payment"
                required
                options={props.data.payments.map((payment) => ({
                  value: payment.id,
                  label: `${payment.number} · ${payment.direction} · ${payment.unmatchedCash}`,
                }))}
              />
            )}
          </FormField>
          <MoneyField label="Match amount" name="amount" required />
          <CommandFeedback
            error={matchMutation.error}
            messages={bankFailureMessages}
            pending={matchMutation.isPending}
            success={matchMutation.isSuccess}
            successMessage="Match recorded."
            reload={props.reload}
            reset={() => matchMutation.reset()}
          />
          <Button
            type="submit"
            loading={matchMutation.isPending}
            disabled={matchMutation.error?.kind === "unknown-outcome"}
          >
            Match
          </Button>
        </Form>
      </Show>
      <h3>Active matches</h3>
      <Show
        when={props.data.matches.length > 0}
        fallback={<p role="status">No active matches on this page.</p>}
      >
        <ul>
          <For each={props.data.matches}>
            {(match) => (
              <li class={layout.detailValue}>
                {match.sourceName}, line {match.lineNumber} · {match.bookingDate} ·{" "}
                {match.description} · {match.reference ?? "No reference"} · {match.paymentNumber} ·{" "}
                {match.amount} · Statement {match.statementId}{" "}
                <Button
                  type="button"
                  disabled={
                    reverseMutation.isPending || reverseMutation.error?.kind === "unknown-outcome"
                  }
                  onClick={() => reverseMutation.mutate(match.id)}
                >
                  Reverse match
                </Button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <CommandFeedback
        error={reverseMutation.error}
        messages={bankFailureMessages}
        pending={reverseMutation.isPending}
        success={reverseMutation.isSuccess}
        successMessage="Match reversed."
        reload={props.reload}
        reset={() => reverseMutation.reset()}
      />
    </>
  )
}

function BankPage(props: {
  legalEntityId: string
  bankAccountId: string
  page: { afterMatchId?: string; lineOffset: number; paymentOffset: number }
  setPage: (page: { afterMatchId?: string; lineOffset: number; paymentOffset: number }) => void
}) {
  const scope = useContext(ApiRuntime)

  const input = {
    legalEntityId: props.legalEntityId,
    bankAccountId: props.bankAccountId,
    ...props.page,
  }

  const query = createServerQuery<BankReconciliation>({
    tenantId: scope.tenantId,
    key: ["settlement", "bank-reconciliation", input],
    cache: "collection",
    load: ({ signal }) => runRequest(scope, getBankReconciliation(input), signal),
  })

  const reload = () => reloaded(query.refetch())

  return (
    <QueryBoundary label="bank reconciliation" retry={reload}>
      <BankActions
        legalEntityId={props.legalEntityId}
        bankAccountId={props.bankAccountId}
        data={query.data}
        reload={reload}
      />
      <Show when={props.page.afterMatchId}>
        <Button
          type="button"
          onClick={() =>
            props.setPage({
              lineOffset: props.page.lineOffset,
              paymentOffset: props.page.paymentOffset,
            })
          }
        >
          First matches
        </Button>
      </Show>
      <Show when={query.data.matches.length === 50}>
        <Button
          type="button"
          onClick={() =>
            props.setPage({
              ...props.page,
              afterMatchId: query.data.matches[query.data.matches.length - 1]!.id,
            })
          }
        >
          Next matches
        </Button>
      </Show>
      <Show when={props.page.lineOffset > 0}>
        <Button
          type="button"
          onClick={() =>
            props.setPage({ ...props.page, lineOffset: Math.max(0, props.page.lineOffset - 50) })
          }
        >
          Previous statement lines
        </Button>
      </Show>
      <Show when={query.data.lines.length === 50}>
        <Button
          type="button"
          onClick={() => props.setPage({ ...props.page, lineOffset: props.page.lineOffset + 50 })}
        >
          Next statement lines
        </Button>
      </Show>
      <Show when={props.page.paymentOffset > 0}>
        <Button
          type="button"
          onClick={() =>
            props.setPage({
              ...props.page,
              paymentOffset: Math.max(0, props.page.paymentOffset - 50),
            })
          }
        >
          Previous payments
        </Button>
      </Show>
      <Show when={query.data.payments.length === 50}>
        <Button
          type="button"
          onClick={() =>
            props.setPage({ ...props.page, paymentOffset: props.page.paymentOffset + 50 })
          }
        >
          Next payments
        </Button>
      </Show>
    </QueryBoundary>
  )
}

function SelectedBank(props: { legalEntityId: string; bankAccountId: string }) {
  const [page, setPage] = createSignal<{
    afterMatchId?: string
    lineOffset: number
    paymentOffset: number
  }>({ lineOffset: 0, paymentOffset: 0 })

  return (
    <Show when={page()} keyed>
      {(current) => (
        <BankPage
          legalEntityId={props.legalEntityId}
          bankAccountId={props.bankAccountId}
          page={current}
          setPage={setPage}
        />
      )}
    </Show>
  )
}

export function BankReconciliationSection(props: { legalEntityId: string }) {
  const scope = useContext(ApiRuntime)
  const accounts = createAccountsQuery(scope, { type: "asset", limit: 200 })
  const [account, setAccount] = createSignal("")

  return (
    <section class={[surface(), layout.stack]} aria-labelledby="bank-reconciliation-heading">
      <h2 id="bank-reconciliation-heading">Bank reconciliation</h2>
      <QueryBoundary label="cash and bank accounts" retry={() => reloaded(accounts.refetch())}>
        <FormField label="Reconciliation account">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              placeholder="Choose an account"
              options={accounts.data.map((item) => ({
                value: item.id,
                label: `${item.code} · ${item.name}`,
              }))}
              onChange={(event) => setAccount(event.currentTarget.value)}
            />
          )}
        </FormField>
        <Show when={accounts.data.length === 0}>
          <p role="status">No asset accounts are available. Configure an account in Finance.</p>
        </Show>
        <Show when={account()} keyed>
          {(id) => <SelectedBank legalEntityId={props.legalEntityId} bankAccountId={id} />}
        </Show>
      </QueryBoundary>
    </section>
  )
}
