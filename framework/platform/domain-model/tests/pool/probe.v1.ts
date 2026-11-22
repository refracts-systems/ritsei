/**
 * A small aggregate whose event gains an optional field in the second model, so the pool test can
 * check that an event recorded before the change decodes after it. This is the first schema.
 */
import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"

export const ProbeId = Schema.String.pipe(Schema.brand("ProbeId"))

export class ProbeNoted extends Domain.Event("ProbeNoted", { text: Schema.String }) {}

export class NoteProbe extends Domain.Command("NoteProbe", {
  target: ProbeId,
  input: { text: Schema.String },
  events: [ProbeNoted],
}) {}

export class Probe extends Domain.Aggregate("Probe", {
  id: ProbeId,
  state: Schema.Struct({ notes: Schema.Int }),
  initial: { notes: 0 },
  commands: [NoteProbe],
  decide: { NoteProbe: (_, command) => [new ProbeNoted({ text: command.text })] },
  evolve: { ProbeNoted: (state) => ({ notes: state.notes + 1 }) },
}) {}
