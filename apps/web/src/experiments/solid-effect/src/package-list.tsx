import { For } from "solid-js"
import type { Package } from "./api"

function formatDownloads(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"

  if (n >= 1_000) return Math.round(n / 1_000) + "k"

  return String(n)
}

export function PackageList(props: { packages: readonly Package[] }) {
  return (
    <ul>
      <For each={props.packages}>
        {(pkg) => (
          <li>
            <div>
              <span class="pkg-name">{pkg.name}</span>
              <span class="pkg-desc">{pkg.description}</span>
            </div>
            <span class="pkg-downloads">{formatDownloads(pkg.downloads)}/wk</span>
          </li>
        )}
      </For>
    </ul>
  )
}
