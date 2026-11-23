/**
 * The key claim (ADR-0124 phase 3) as the Effect Cluster pool serves it: one claim aggregate and the
 * Api a client sends concurrent claims through. It is the same decision as the modules' claim copies
 * (`erp/modules/sales/src/confirmation-claim-model.ts`), without their saga, so the proof isolates
 * the property that matters: the host runs commands for one aggregate instance one at a time.
 * The model keeps the pilot's name so the pool and the host options are the ones the pilot uses.
 */
import * as Domain from "@alchemy.run/domain"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

export const ClaimId = Schema.String.pipe(Schema.brand("ClaimProofId"))

export class ClaimHeld extends Domain.Rejection("ClaimHeld", { holder: Schema.String }) {}

export class KeyClaimed extends Domain.Event("KeyClaimed", { holder: Schema.String }) {}

export class KeyReleased extends Domain.Event("KeyReleased", { holder: Schema.String }) {}

export class ClaimKey extends Domain.Command("ClaimKey", {
  target: ClaimId,
  input: { holder: Schema.String },
  events: [KeyClaimed],
  rejects: [ClaimHeld],
}) {}

export class ReleaseKey extends Domain.Command("ReleaseKey", {
  target: ClaimId,
  input: { holder: Schema.String },
  events: [KeyReleased],
}) {}

const Free = Schema.TaggedStruct("Free", {})
const Held = Schema.TaggedStruct("Held", { holder: Schema.String })

export class KeyClaim extends Domain.Aggregate("KeyClaim", {
  id: ClaimId,
  state: Schema.Union([Free, Held]),
  initial: Free.make({}),
  commands: [ClaimKey, ReleaseKey],
  decide: {
    ClaimKey: (claim, cmd) => {
      if (!Predicate.isTagged(claim, "Held")) return [new KeyClaimed({ holder: cmd.holder })]

      return claim.holder === cmd.holder ? [] : new ClaimHeld({ holder: claim.holder })
    },
    ReleaseKey: (claim, cmd) =>
      Predicate.isTagged(claim, "Held") && claim.holder === cmd.holder
        ? [new KeyReleased({ holder: cmd.holder })]
        : [],
  },
  evolve: {
    KeyClaimed: (_, e) => Held.make({ holder: e.holder }),
    KeyReleased: () => Free.make({}),
  },
}) {}

export class ClaimProofModel extends Domain.Model("PilotModel", { aggregates: [KeyClaim] }) {}

export class ClaimProofApi extends Domain.Api("PilotApi", { model: ClaimProofModel }) {}
