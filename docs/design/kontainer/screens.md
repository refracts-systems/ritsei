# Kontainer screens: where each one stands

> **Status:** Map of the six series E screens against the application, as of 2026-11-24. The
> palette, fonts, and shape are adopted ([ADR-0127](../../decisions/0127-adopt-the-kontainer-visual-language.md));
> this map is about the screens. Statuses were checked against `apps/web` and the generated browser
> contracts; where something was not checked it says so.

| Screen            | In the application                                                               | Data it needs                                                                | Status                                                                                                                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1 Dermaga        | "Waiting for you" on My work, pending approvals with Approve and Reject in place | `GET /approvals/requests` is served                                          | **Partial.** Approvals only. Department tabs, stock reorders, and due invoices need queues no web contract serves yet (not found in `apps/web/src/features`)                                                                                                                                        |
| E2 Manifest       | Document flow on documents (`DocumentFlow` pattern)                              | `GET /documents/chain` is served: type, number, state, amount, date, current | **Partial.** The chain is built as typed nodes (tag, number, state, amount, date, the current one framed in the accent). The mockup's header (owner, customer), timeline, and four sizes of one object are not in the chain response; whether the object's own endpoints serve them was not checked |
| E3 Yard           | None                                                                             | Documents counted per stage and per organization level                       | **Blocked.** No aggregate by stage exists in the browser contracts                                                                                                                                                                                                                                  |
| E4 Process Studio | Process Studio exists: designer, catalog, validation                             | Served by the process contracts                                              | **Exists.** It takes the new palette with no change; whether its layout matches the mockup was not compared                                                                                                                                                                                         |
| E5 Cari           | Ctrl+K opens a palette of workspaces (routes only)                               | A search over objects                                                        | **Blocked for objects.** No search endpoint in the generated contracts. A palette that only navigates the workspace list would use real routes and no new data                                                                                                                                      |
| E6 Tutup hari     | None                                                                             | A day-closing concept                                                        | **Blocked.** The backend has no such concept; it needs a product decision first                                                                                                                                                                                                                     |

## Components the mockups use

| Component                                         | In the application                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Queue row with an in-place action                 | `RequestTable` rows (`DataTable`), used by Dermaga                                                                  |
| Type tag (SAL, PRC, INV, FIN, HRD) and its color  | `TypeTag`; shown in the approvals queue for the modules that map to a type (procurement, billing, sales, inventory) |
| Ink frame around a surface                        | The `surface` recipe, default and flush tones                                                                       |
| Seal that marks a done action                     | Not built. A status line says "Decision recorded." today                                                            |
| Stacks per stage                                  | Not built                                                                                                           |
| Manifest label (code, type, owner, status, value) | `DocumentFlow` nodes show type tag, kind, number, state, amount, date; owner is not in the chain response           |

## Order of work

Screens whose data is already served come first and need no backend change: the E1 type tag and
frame (done), then E2 (the chain is done; the header, timeline, and sizes wait for data). E5 as a navigation palette needs no data but is a product choice, because the
mockup promised object search. E3 and E6 wait for backend decisions; nothing here adds a placeholder
for them. What each of them needs, and what the owner decides, is in
[`kontainer-backend.md`](../../proposals/kontainer-backend.md).
