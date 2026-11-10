# Archived Architecture Decision Records

> **Related documents**
>
> - ADR index: [`../README.md`](../README.md)
> - Decision map: [`../decision-map.md`](../decision-map.md)

Every ADR in this folder has the status Superseded and records what was decided and why at the time.
Each file names the ADR that replaced it in its `Superseded by` line. Check the scope of the
supersession: a later decision may replace only part of an earlier one.

Start with the [decision map](../decision-map.md) and the current owning documents. Read an archived
ADR when tracing a decision's history, and use the superseding decision and current owning documents
to determine what still applies. Report contradictions rather than assuming the code is correct.

When an ADR becomes Superseded, set its status, fill in `Superseded by`, and move it here with
`git mv` in the same change. Links from other documents keep working because they are rewritten to
this folder.
