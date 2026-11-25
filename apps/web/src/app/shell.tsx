import { useLocation, useNavigate } from "@solidjs/router"
import type { JSX } from "@solidjs/web"
import {
  createSignal,
  Errored,
  For,
  lazy,
  Loading,
  onSettled,
  Show,
  untrack,
  useContext,
} from "solid-js"
import { layout } from "../ui/foundations/layout.ts"
import { Icon, type IconName } from "../ui/icons/index.ts"
import type { PaletteEntry } from "../ui/patterns/command-palette.tsx"
import { Button } from "../ui/primitives/button.tsx"
import { logout as logoutSession } from "./auth-client.ts"
import { moduleWorkspaces } from "./routes.gen.ts"
import { SessionContext } from "./session.ts"
import { type NavigationGroup, navigationGroups } from "./workspace.ts"

// Dialog code loads after the first paint so it stays out of the entry chunk.
const ConfirmDialog = lazy(() => import("../ui/patterns/confirm-dialog.tsx"), {
  export: "ConfirmDialog",
})

const CommandPalette = lazy(() => import("../ui/patterns/command-palette.tsx"), {
  export: "CommandPalette",
})

type NavigationItem = Readonly<{
  label: string
  icon: IconName
  href: string
}>

type NavigationSection = Readonly<{
  label: string
  items: readonly NavigationItem[]
}>

// Framework pages; ERP module entries come from the generated module workspaces.
const frameworkNavigation: Readonly<Record<NavigationGroup, readonly NavigationItem[]>> = {
  Operations: [],
  Processes: [{ label: "Approvals", icon: "status.success", href: "/approvals" }],
  Administration: [
    { label: "User accounts", icon: "navigation.user-accounts", href: "/user-accounts" },
    { label: "Access", icon: "navigation.access", href: "/access" },
  ],
}

const navigationSections: readonly NavigationSection[] = [
  {
    label: "Work",
    items: [{ label: "My work", icon: "navigation.home", href: "/" }],
  },
  ...navigationGroups.flatMap((group): NavigationSection[] => {
    const items = [
      ...moduleWorkspaces
        .filter((workspace) => workspace.group === group)
        .map(({ label, icon, href }) => ({ label, icon, href })),
      ...frameworkNavigation[group],
    ]

    return items.length > 0 ? [{ label: group, items }] : []
  }),
]

const paletteEntries: readonly PaletteEntry[] = navigationSections.flatMap((section) =>
  section.items.map((item) => ({ label: item.label, href: item.href, group: section.label })),
)

const compactTenantId = (tenantId: string): string =>
  `${tenantId.slice(0, 8)}…${tenantId.slice(-4)}`

const THEME_STORAGE_KEY = "ritsei.theme"

const initialDarkTheme = (): boolean => {
  try {
    const stored = globalThis.localStorage?.getItem(THEME_STORAGE_KEY)

    if (stored === "dark" || stored === "light") return stored === "dark"
  } catch {
    // Storage can be unavailable (private mode, blocked site data); use the OS preference.
  }

  return globalThis.matchMedia("(prefers-color-scheme: dark)").matches
}

const persistTheme = (dark: boolean) => {
  // Portaled overlays (dialogs, popovers) render outside the shell, so the root carries the theme.
  document.documentElement.dataset["theme"] = dark ? "dark" : "light"

  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light")
  } catch {
    // Persisting the preference is a convenience only.
  }
}

function ContextItem(props: { label: string; value: string; title?: string; code?: boolean }) {
  return (
    <span class={layout.barContext} title={props.title}>
      <span class={layout.barContextLabel}>{props.label}</span>
      <span class={[layout.barContextValue, props.code && layout.barContextCode]}>
        {props.value}
      </span>
    </span>
  )
}

const isCurrentDestination = (pathname: string, href: string): boolean =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)

/** The link to the page itself is "page"; the link to the area a page sits inside is "true". */
const placeOf = (pathname: string, href: string): "page" | "true" | undefined => {
  if (!isCurrentDestination(pathname, href)) return undefined

  return pathname === href ? "page" : "true"
}

const isPaletteShortcut = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k"

// Fallow: the shell intentionally orchestrates the bar, the palette, session state, and workspace layout.
// fallow-ignore-next-line complexity
export function ApplicationShell(props: { children: JSX.Element }) {
  const session = useContext(SessionContext)
  const location = useLocation()
  const navigate = useNavigate()
  const [dark, setDark] = createSignal(initialDarkTheme())
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  // The palette code loads the first time it is asked for, and stays mounted after.
  const [paletteWanted, setPaletteWanted] = createSignal(false)
  let menuToggle: HTMLButtonElement | undefined

  const openPalette = () => {
    setPaletteWanted(true)
    setPaletteOpen(true)
  }

  const toggleTheme = () => {
    const next = !dark()
    setDark(next)
    persistTheme(next)
  }

  onSettled(() => {
    document.documentElement.dataset["theme"] = untrack(dark) ? "dark" : "light"

    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuOpen()) {
        event.preventDefault()
        setMenuOpen(false)
        menuToggle?.focus()

        return
      }

      if (isPaletteShortcut(event)) {
        event.preventDefault()
        openPalette()
      }
    }

    document.addEventListener("keydown", handleKeyboard)

    return () => document.removeEventListener("keydown", handleKeyboard)
  })

  return (
    <div data-theme={dark() ? "dark" : "light"} class={layout.page}>
      <a class={layout.skip} href="#main">
        Skip to content
      </a>
      <header class={layout.bar}>
        <div class={layout.barRow}>
          <a href="/" aria-label="RITSEI home" class={layout.brand}>
            RITSEI
          </a>
          <button type="button" class={layout.barCommand} onClick={openPalette}>
            Ctrl K · go to a workspace
          </button>
          <div role="group" aria-label="Operating context" class={layout.barActions}>
            <Show
              when={session.current()}
              keyed
              fallback={<ContextItem label="Session" value="Not connected" />}
            >
              {(current) => (
                <Show
                  when={session.tenants().length > 1}
                  fallback={
                    <ContextItem
                      label="Tenant"
                      value={compactTenantId(current.tenantId)}
                      title={current.tenantId}
                      code
                    />
                  }
                >
                  <label class={layout.barContext}>
                    <span class={layout.barContextLabel}>Tenant</span>
                    <select
                      aria-label="Active tenant"
                      value={current.tenantId}
                      onChange={(event) => session.selectTenant(event.currentTarget.value)}
                    >
                      <For each={session.tenants()}>
                        {(tenant) => (
                          <option value={tenant.tenantId}>
                            {compactTenantId(tenant.tenantId)}
                          </option>
                        )}
                      </For>
                    </select>
                  </label>
                </Show>
              )}
            </Show>
            <Button
              ref={(element) => (menuToggle = element)}
              iconOnly
              variant="bar"
              size="sm"
              type="button"
              class={layout.barMenuToggle}
              aria-label={menuOpen() ? "Close navigation" : "Open navigation"}
              aria-controls="primary-navigation"
              aria-expanded={menuOpen() ? "true" : "false"}
              onClick={() => setMenuOpen(!menuOpen())}
            >
              <Icon name="navigation.menu" size="md" />
            </Button>
            <Button
              type="button"
              iconOnly
              variant="bar"
              size="sm"
              aria-label="Dark theme"
              aria-pressed={dark() ? "true" : "false"}
              title={dark() ? "Switch to light theme" : "Switch to dark theme"}
              onClick={toggleTheme}
            >
              <Icon name={dark() ? "system.theme-light" : "system.theme-dark"} size="md" />
              <span class="sr-only">Dark theme</span>
            </Button>
            <Show when={session.current()}>
              <Loading>
                <ConfirmDialog
                  triggerLabel="Sign out"
                  triggerVariant="bar"
                  title="Sign out of RITSEI?"
                  description="Your in-memory session credentials will be cleared."
                  confirmLabel="Sign out"
                  onConfirm={() => {
                    const current = session.current()

                    if (current !== null) void logoutSession(current.token).catch(() => undefined)
                    session.replace(null)
                    navigate("/", { replace: true })
                  }}
                />
              </Loading>
            </Show>
          </div>
          <nav
            id="primary-navigation"
            aria-label="Primary"
            class={layout.barNavigation}
            data-open={menuOpen() ? "true" : "false"}
          >
            <For each={navigationSections}>
              {(section) => (
                <section class={layout.barGroup} aria-label={section.label}>
                  <h2 class={layout.barGroupLabel}>{section.label}</h2>
                  <For each={section.items}>
                    {(item) => (
                      <a
                        href={item.href}
                        class={layout.barLink}
                        data-active={
                          placeOf(location.pathname, item.href) === undefined ? undefined : ""
                        }
                        aria-current={placeOf(location.pathname, item.href)}
                        onClick={() => setMenuOpen(false)}
                      >
                        {item.label}
                      </a>
                    )}
                  </For>
                </section>
              )}
            </For>
          </nav>
        </div>
      </header>
      <main id="main" tabindex="-1" class={layout.main}>
        <Errored
          fallback={
            <section class={layout.stack}>
              <h1>Workspace unavailable</h1>
              <p role="alert">This workspace could not load. Reload the page to try again.</p>
              <div class={layout.row}>
                <Button type="button" onClick={() => globalThis.location.reload()}>
                  Reload page
                </Button>
              </div>
            </section>
          }
        >
          <Loading fallback={<p role="status">Loading workspace…</p>}>{props.children}</Loading>
        </Errored>
      </main>
      <Show when={paletteWanted()}>
        <Loading>
          <CommandPalette
            entries={paletteEntries}
            open={paletteOpen()}
            onOpenChange={setPaletteOpen}
            onChoose={(href) => {
              setPaletteOpen(false)
              navigate(href)
            }}
          />
        </Loading>
      </Show>
    </div>
  )
}
