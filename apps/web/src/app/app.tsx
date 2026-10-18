import { createRouter, useNavigate } from "@solidjs/router"
import { createSignal, For, lazy, onSettled, Show, useContext } from "solid-js"
import type { AuthSession } from "../shared/contracts/generated/auth.ts"
import type { Session } from "../shared/session.ts"
import { layout } from "../ui/foundations/layout.ts"
import { Icon, type IconName } from "../ui/icons/index.ts"
import { OperationalWorkspace } from "../ui/patterns/operational-workspace.tsx"
import { AuthCallback } from "./auth-callback.tsx"
import { AuthClientFailure, getAuthSession } from "./auth-client.ts"
import { Connection } from "./connection.tsx"
import {
  type AuthenticatedUser,
  type Capability,
  SessionContext,
  type TenantOption,
} from "./session.ts"
import { ApplicationShell } from "./shell.tsx"

const AccessRoute = lazy(() => import("./access-route.tsx"))
const AccountsRoute = lazy(() => import("./accounts-route.tsx"))
const PartiesRoute = lazy(() => import("./parties-route.tsx"))
const ProcurementRoute = lazy(() => import("./procurement-route.tsx"))
const InventoryRoute = lazy(() => import("./inventory-route.tsx"))
const SalesRoute = lazy(() => import("./sales-route.tsx"))
const AccountingRoute = lazy(() => import("./accounting-route.tsx"))
const ProcessRoute = lazy(() => import("./process-route.tsx"))

const workspaceDirectory: readonly Readonly<{
  href: string
  label: string
  description: string
  icon: IconName
}>[] = [
  {
    href: "/sales",
    label: "Revenue",
    description: "Customers, quotations, and sales orders.",
    icon: "navigation.sales",
  },
  {
    href: "/procurement",
    label: "Supply",
    description: "Suppliers and purchase orders.",
    icon: "navigation.procurement",
  },
  {
    href: "/inventory",
    label: "Inventory",
    description: "Items, warehouses, stock, and reservations.",
    icon: "navigation.inventory",
  },
  {
    href: "/accounting",
    label: "Finance",
    description: "Accounts, periods, and journal entries.",
    icon: "navigation.accounting",
  },
  {
    href: "/processes",
    label: "Process Studio",
    description: "Design and monitor business processes.",
    icon: "navigation.process",
  },
  {
    href: "/parties",
    label: "Parties",
    description: "Organizations, legal entities, and branches.",
    icon: "navigation.parties",
  },
  {
    href: "/user-accounts",
    label: "User accounts",
    description: "People who can sign in to this tenant.",
    icon: "navigation.user-accounts",
  },
  {
    href: "/access",
    label: "Access",
    description: "Memberships and capability grants.",
    icon: "navigation.access",
  },
]

function HomeRoute() {
  const session = useContext(SessionContext)
  return (
    <Show when={session.current()} fallback={<Connection />}>
      <OperationalWorkspace
        title="My work"
        description={<p>Connected workspaces for this tenant.</p>}
      >
        <section class={layout.stack} aria-labelledby="available-workspace-heading">
          <h2 id="available-workspace-heading">Available workspaces</h2>
          <p class={layout.workspaceDescription}>
            Choose a workspace to work with records and processes linked to this tenant.
          </p>
          <ul class={layout.directoryList}>
            <For each={workspaceDirectory}>
              {(entry) => (
                <li>
                  <a href={entry.href} class={layout.directoryCard}>
                    <span class={layout.directoryIcon}>
                      <Icon name={entry.icon} size="md" />
                    </span>
                    <span class={layout.directoryTitle}>{entry.label}</span>
                    <span class={layout.directoryDescription}>{entry.description}</span>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </section>
      </OperationalWorkspace>
    </Show>
  )
}

function NotFound() {
  return (
    <section class={layout.stack}>
      <h1>Page not found</h1>
      <p>The requested workspace is not registered in this application.</p>
      <a href="/">Return to My work</a>
    </section>
  )
}

function SessionRecovery() {
  const session = useContext(SessionContext)
  const navigate = useNavigate()
  onSettled(() => {
    const recover = () => {
      session.replace(null)
      navigate("/login", { replace: true })
    }
    globalThis.addEventListener("ritsei:unauthorized", recover)
    return () => globalThis.removeEventListener("ritsei:unauthorized", recover)
  })
  return null
}

const Router = createRouter({
  preloadLinks: false,
  routes: [
    { path: "/", component: HomeRoute },
    { path: "/login", component: Connection },
    { path: "/auth/callback", component: AuthCallback },
    { path: "/user-accounts", component: AccountsRoute },
    { path: "/user-accounts/:id", component: AccountsRoute },
    { path: "/parties", component: PartiesRoute },
    { path: "/parties/:id", component: PartiesRoute },
    { path: "/access", component: AccessRoute },
    { path: "/access/:id", component: AccessRoute },
    { path: "/procurement", component: ProcurementRoute },
    { path: "/procurement/:id", component: ProcurementRoute },
    { path: "/inventory", component: InventoryRoute },
    { path: "/inventory/:id", component: InventoryRoute },
    { path: "/sales", component: SalesRoute },
    { path: "/sales/customers/:id", component: SalesRoute },
    { path: "/sales/quotations/:id", component: SalesRoute },
    { path: "/sales/orders/:id", component: SalesRoute },
    { path: "/accounting", component: AccountingRoute },
    { path: "/accounting/:id", component: AccountingRoute },
    { path: "/processes", component: ProcessRoute },
    { path: "/processes/:id", component: ProcessRoute },
    { path: "*missing", component: NotFound },
  ],
})

export function App() {
  const [session, setSession] = createSignal<Session | null>(null)
  const [user, setUser] = createSignal<AuthenticatedUser | null>(null)
  const [tenants, setTenants] = createSignal<readonly TenantOption[]>([])
  const [capabilities, setCapabilities] = createSignal<readonly Capability[]>([])
  const replace = (next: Session | null, details?: AuthSession) => {
    setSession(next)
    if (next === null || details === undefined) {
      setUser(null)
      setTenants([])
      setCapabilities([])
    } else {
      setUser(details.user)
      setTenants(details.memberships)
      setCapabilities(details.capabilities)
    }
  }
  const selectTenant = async (tenantId: string) => {
    if (!tenants().some((tenant) => tenant.tenantId === tenantId)) return
    const current = session()
    if (current === null || current.tenantId === tenantId) return
    try {
      const details = await getAuthSession(current.token, tenantId)
      if (details.activeTenant?.tenantId !== tenantId) return
      setUser(details.user)
      setTenants(details.memberships)
      setCapabilities(details.capabilities)
      setSession({ ...current, tenantId })
    } catch (error) {
      if (error instanceof AuthClientFailure && error.kind === "unauthorized") {
        globalThis.dispatchEvent(new Event("ritsei:unauthorized"))
      }
    }
  }
  return (
    <SessionContext
      value={{ current: session, user, tenants, capabilities, replace, selectTenant }}
    >
      <Router>
        {(props) => (
          <>
            <SessionRecovery />
            <ApplicationShell>{props.children}</ApplicationShell>
          </>
        )}
      </Router>
    </SessionContext>
  )
}
