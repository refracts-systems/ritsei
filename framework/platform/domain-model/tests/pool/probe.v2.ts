/** The second schema of the probe event: one optional field added; nothing renamed or removed. */
import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"

export const ProbeId = Schema.String.pipe(Schema.brand("ProbeId"))

export class ProbeNoted extends Domain.Event("ProbeNoted", {
  text: Schema.String,
  tag: Schema.optional(Schema.String),
}) {}

export class NoteProbe extends Domain.Command("NoteProbe", {
  target: ProbeId,
  input: { text: Schema.String, tag: Schema.optional(Schema.String) },
  events: [ProbeNoted],
}) {}

export class Probe extends Domain.Aggregate("Probe", {
  id: ProbeId,
  state: Schema.Struct({ notes: Schema.Int }),
  initial: { notes: 0 },
  commands: [NoteProbe],
  decide: {
    NoteProbe: (_, command) => [new ProbeNoted({ text: command.text, tag: command.tag })],
  },
  evolve: { ProbeNoted: (state) => ({ notes: state.notes + 1 }) },
}) {}
