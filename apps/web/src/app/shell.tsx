import { useLocation, useNavigate } from "@solidjs/router"
import type { JSX } from "@solidjs/web"
import {
  createMemo,
  createSignal,
  Errored,
  For,
  Loading,
  onSettled,
  Show,
  untrack,
  useContext,
} from "solid-js"
import { layout } from "../ui/foundations/layout.ts"
import { Icon, type IconName } from "../ui/icons/index.ts"
import { ConfirmDialog } from "../ui/patterns/confirm-dialog.tsx"
import { Button } from "../ui/primitives/button.tsx"
import { logout as logoutSession } from "./auth-client.ts"
import { moduleWorkspaces } from "./routes.gen.ts"
import { SessionContext } from "./session.ts"
import { type NavigationGroup, navigationGroups } from "./workspace.ts"

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
  Processes: [],
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

type LocalNavigation = Readonly<{
  area: string
  items: readonly Readonly<{ label: string; href: string }>[]
}>

// The local-navigation route table: framework pages, then one entry per module workspace.
const localNavigationTable: readonly (LocalNavigation & { href: string })[] = [
  {
    href: "/user-accounts",
    area: "Identity",
    items: [{ label: "Accounts", href: "/user-accounts" }],
  },
  { href: "/access", area: "Authorization", items: [{ label: "Access", href: "/access" }] },
  ...moduleWorkspaces.map(({ href, area, section }) => ({
    href,
    area,
    items: [{ label: section, href }],
  })),
]

const localNavigationFor = (pathname: string): LocalNavigation =>
  localNavigationTable.find(({ href }) => isCurrentDestination(pathname, href)) ?? {
    area: "Work",
    items: [{ label: "Overview", href: "/" }],
  }

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

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable)

function ContextItem(props: { label: string; value: string; title?: string; code?: boolean }) {
  return (
    <span class={layout.contextItem} title={props.title}>
      <span class={layout.contextLabel}>{props.label}</span>
      <span class={[layout.contextValue, props.code && layout.contextCode]}>{props.value}</span>
    </span>
  )
}

const isCurrentDestination = (pathname: string, href: string): boolean =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)

const navigationState = (active: boolean) =>
  active
    ? ({ marker: "", current: "page", icon: "fill" } as const)
    : ({ marker: undefined, current: undefined, icon: "regular" } as const)

function NavigationEntry(props: {
  item: NavigationItem
  active: boolean
  collapsed: boolean
  closeMobile: () => void
  captureFirst?: (element: HTMLAnchorElement) => void
}) {
  const item = untrack(() => props.item)
  const closeMobile = untrack(() => props.closeMobile)
  const captureFirst = untrack(() => props.captureFirst)

  const labelClass = () => [
    layout.navigationLabel,
    props.collapsed && layout.navigationLabelCollapsed,
  ]

  const state = () => navigationState(props.active)

  return (
    <a
      ref={(element) => captureFirst?.(element)}
      href={item.href}
      class={layout.navigationItem}
      data-active={state().marker}
      aria-current={state().current}
      aria-label={item.label}
      title={props.collapsed ? item.label : undefined}
      onClick={closeMobile}
    >
      <span class={layout.navigationMarker}>
        <Icon name={item.icon} size="md" variant={state().icon} />
      </span>
      <span class={labelClass()}>{item.label}</span>
    </a>
  )
}

// Fallow: the shell intentionally orchestrates responsive navigation, session state, and workspace layout.
// fallow-ignore-next-line complexity
export function ApplicationShell(props: { children: JSX.Element }) {
  const session = useContext(SessionContext)
  const location = useLocation()
  const navigate = useNavigate()
  const [dark, setDark] = createSignal(initialDarkTheme())
  const [collapsed, setCollapsed] = createSignal(false)
  const [compact, setCompact] = createSignal(globalThis.matchMedia("(max-width: 767px)").matches)
  const [mobileOpen, setMobileOpen] = createSignal(false)
  const localNavigation = createMemo(() => localNavigationFor(location.pathname))
  let navigationToggle: HTMLButtonElement | undefined
  let firstNavigationLink: HTMLAnchorElement | undefined

  const firstLinkCapture = (section: number, item: number) =>
    section === 0 && item === 0
      ? (element: HTMLAnchorElement) => (firstNavigationLink = element)
      : undefined

  const navigationExpanded = () => (compact() ? mobileOpen() : !collapsed())
  const toggleLabel = () => (navigationExpanded() ? "Collapse navigation" : "Open navigation")

  const toggleNavigation = () => {
    if (compact()) {
      const opening = !mobileOpen()
      setMobileOpen(opening)

      if (opening) queueMicrotask(() => firstNavigationLink?.focus())

      return
    }

    setCollapsed(!collapsed())
  }

  const closeMobileNavigation = () => {
    if (compact()) setMobileOpen(false)
  }

  const dismissMobileNavigation = () => {
    if (!compact() || !mobileOpen()) return
    setMobileOpen(false)
    queueMicrotask(() => navigationToggle?.focus())
  }

  const toggleTheme = () => {
    const next = !dark()
    setDark(next)
    persistTheme(next)
  }

  onSettled(() => {
    document.documentElement.dataset["theme"] = untrack(dark) ? "dark" : "light"
    const media = globalThis.matchMedia("(max-width: 767px)")

    const handleViewport = (event: MediaQueryListEvent) => {
      setCompact(event.matches)

      if (!event.matches) setMobileOpen(false)
    }

    // Fallow: keyboard shortcuts intentionally combine Escape dismissal and navigation toggle paths.
    // fallow-ignore-next-line complexity
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && mobileOpen()) {
        event.preventDefault()
        dismissMobileNavigation()

        return
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "b" &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault()
        toggleNavigation()
      }
    }

    media.addEventListener("change", handleViewport)
    document.addEventListener("keydown", handleKeyboard)

    return () => {
      media.removeEventListener("change", handleViewport)
      document.removeEventListener("keydown", handleKeyboard)
    }
  })

  return (
    <div data-theme={dark() ? "dark" : "light"} class={layout.page}>
      <a class={layout.skip} href="#main">
        Skip to content
      </a>
      <div class={[layout.shellBody, collapsed() && layout.shellBodyCollapsed]}>
        <Show when={compact() && mobileOpen()}>
          <button
            type="button"
            class={layout.navigationBackdrop}
            aria-label="Close navigation"
            onClick={dismissMobileNavigation}
          />
        </Show>
        <aside
          id="global-navigation"
          class={layout.sidebar}
          data-mobile-open={mobileOpen() ? "true" : "false"}
          data-collapsed={collapsed() ? "true" : "false"}
          aria-label="Global navigation"
          aria-hidden={compact() && !mobileOpen() ? "true" : undefined}
          inert={compact() && !mobileOpen() ? true : undefined}
        >
          <div class={layout.sidebarHeader}>
            <a href="/" aria-label="RITSEI home" class={layout.brand}>
              <img src="/logo.svg" alt="" class={layout.brandLogo} />
              <span class={layout.brandMark} aria-hidden="true">
                R
              </span>
            </a>
          </div>
          <nav aria-label="Primary" class={layout.navigation}>
            <For each={navigationSections}>
              {(section, sectionIndex) => (
                <section class={layout.navigationSection} aria-label={section.label}>
                  <h2
                    class={[
                      layout.navigationSectionLabel,
                      collapsed() && layout.navigationSectionLabelCollapsed,
                    ]}
                  >
                    {section.label}
                  </h2>
                  <div class={layout.navigationList}>
                    <For each={section.items}>
                      {(item, itemIndex) => (
                        <NavigationEntry
                          item={item}
                          active={isCurrentDestination(location.pathname, item.href)}
                          collapsed={collapsed()}
                          closeMobile={closeMobileNavigation}
                          captureFirst={firstLinkCapture(sectionIndex(), itemIndex())}
                        />
                      )}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </nav>
        </aside>

        <div class={layout.workspace}>
          <header class={layout.topbar}>
            <a href="/" aria-label="RITSEI home" class={[layout.brand, layout.brandMobile]}>
              <img src="/logo.svg" alt="" class={layout.brandLogo} />
            </a>
            <Button
              ref={(element) => (navigationToggle = element)}
              iconOnly
              variant="ghost"
              size="sm"
              type="button"
              class={layout.navigationToggle}
              aria-label={toggleLabel()}
              aria-controls="global-navigation"
              aria-expanded={navigationExpanded() ? "true" : "false"}
              title={`${toggleLabel()} (⌘B or Ctrl+B)`}
              onClick={toggleNavigation}
            >
              <Icon name={compact() ? "navigation.menu" : "navigation.sidebar"} size="md" />
            </Button>
            <div class={layout.localNavigation}>
              <span class={layout.localArea}>{localNavigation().area}</span>
              <nav
                aria-label={`${localNavigation().area} sections`}
                class={layout.localNavigationLinks}
              >
                <For each={localNavigation().items}>
                  {(item) => (
                    <a
                      href={item.href}
                      data-active={
                        location.pathname === item.href ||
                        location.pathname.startsWith(`${item.href}/`)
                          ? ""
                          : undefined
                      }
                      aria-current={location.pathname === item.href ? "page" : undefined}
                    >
                      {item.label}
                    </a>
                  )}
                </For>
              </nav>
            </div>
            <div class={layout.contextStrip} aria-label="Operating context">
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
                    <label class={layout.contextItem}>
                      <span class={layout.contextLabel}>Tenant</span>
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
            </div>
            <div class={layout.topbarActions}>
              <Button
                type="button"
                iconOnly
                variant="ghost"
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
                <ConfirmDialog
                  triggerLabel="Sign out"
                  triggerVariant="ghost"
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
              </Show>
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
        </div>
      </div>
    </div>
  )
}
