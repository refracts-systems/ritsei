import * as Schema from "effect/Schema"

export const Session = Schema.Struct({
  tenantId: Schema.String.check(Schema.isUUID()),
  token: Schema.String.check(Schema.isPattern(/^\S+$/), Schema.isMaxLength(4096)),
})

export type Session = typeof Session.Type
