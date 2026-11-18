// Read path: an Effect program consumed directly by a memo.
//
// There is no integration code in this file beyond `runEffect`. The memo
// returns an AsyncIterable and Solid does the rest: pending flows to
// <Loading>, exhausted retries flow to <Errored>, `latest`/`isPending` give
// stale-while-revalidate. Type fast and watch the event log: every
// superseded keystroke's fiber — including its pending retries — is
// interrupted by Solid closing the flight's iterator. No debounce, no
// AbortController, no request bookkeeping anywhere in this component.

import type { ManagedRuntime } from "effect"
import { createMemo, createSignal, Errored, isPending, latest, Loading, Show } from "solid-js"
import { type Package, type SearchConfig, searchPackages } from "./api"
import { PackageList } from "./package-list"
import { runEffect } from "./solid-effect"

function Results(props: { results: () => Package[]; query: string }) {
  const list = () => latest(props.results)

  return (
    <div class={{ results: true, stale: isPending(props.results) }}>
      <Show
        when={list().length > 0}
        fallback={
          <p class="empty">
            {isPending(props.results) ? "Searching…" : `No packages match “${props.query}”.`}
          </p>
        }
      >
        <PackageList packages={list()} />
      </Show>
    </div>
  )
}

export function Typeahead(props: { runtime: ManagedRuntime.ManagedRuntime<SearchConfig, never> }) {
  const [query, setQuery] = createSignal("")

  // The whole data layer. searchPackages carries retry w/ backoff, timeout,
  // typed transient errors, and interruption finalizers — declared over
  // there, invisible here.
  const results = createMemo<Package[]>(() => {
    const q = query().trim()

    if (!q) return []

    return runEffect(searchPackages(q), props.runtime)
  })

  return (
    <section class="panel">
      <header>
        <h2>Typeahead search</h2>
        <p>
          Each keystroke starts an Effect fiber (retry ×3 w/ exponential backoff, 4s timeout, ~35%
          transient failure rate). Superseded flights are <em>interrupted</em>, not ignored — Solid
          closes the stale iterator, <code>runEffect</code> interrupts the fiber.
        </p>
      </header>
      <input
        id="custom-package-search"
        name="package-search"
        type="search"
        aria-label="Search packages"
        placeholder="Search packages… (try typing “solid” quickly)"
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
        autofocus
      />
      <Show when={query().trim()}>
        {(q) => (
          <Errored
            fallback={(err, reset) => (
              <div class="error-box">
                <p>Search gave up after retries: {String(err())}</p>
                <button onClick={reset}>Try again</button>
              </div>
            )}
          >
            <Loading fallback={<p class="loading">Searching…</p>}>
              <Results results={results} query={q()} />
            </Loading>
          </Errored>
        )}
      </Show>
    </section>
  )
}
