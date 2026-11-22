import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"

import { Probe } from "./probe.v2.ts"

/** The probe's notes and how many carry the field added in the second schema. */
export class ProbeNotes extends Domain.View("ProbeNotes", {
  from: [Probe],
  key: Probe,
  state: Schema.Struct({ notes: Schema.Int, tagged: Schema.Int }),
  initial: { notes: 0, tagged: 0 },
  evolve: {
    ProbeNoted: (view, event) => ({
      notes: view.notes + 1,
      tagged: view.tagged + (event.tag === undefined ? 0 : 1),
    }),
  },
}) {}
