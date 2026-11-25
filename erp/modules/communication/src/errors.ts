import * as Schema from "effect/Schema"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const Uuid = Schema.String.check(Schema.isUUID())

export class UnsupportedCommunicationEvent extends Schema.TaggedError<UnsupportedCommunicationEvent>()(
  "UnsupportedCommunicationEvent",
  {
    eventType: NonEmptyString,
    eventVersion: Schema.Int,
  },
) {}

export class CommunicationNotFound extends Schema.TaggedError<CommunicationNotFound>()(
  "CommunicationNotFound",
  { communicationId: Uuid },
) {}

/** The caller approved a different rendering than the one that would be sent. */
export class CommunicationPreviewStale extends Schema.TaggedError<CommunicationPreviewStale>()(
  "CommunicationPreviewStale",
  { communicationId: Uuid, previewedArtifactId: Uuid, currentArtifactId: Uuid },
) {}

export class CommunicationStateFailure extends Schema.TaggedError<CommunicationStateFailure>()(
  "CommunicationStateFailure",
  { reason: NonEmptyString },
) {}
