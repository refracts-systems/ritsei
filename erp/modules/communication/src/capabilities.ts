// Deny by default: a tenant administrator must grant each capability before it takes effect.
export const CommunicationCapabilities = {
  historicalDispatchRecord: "communication.historical_dispatch.record",
  /** Previews a rendered communication and reads its delivery attempts; sends nothing. */
  communicationRead: "communication.communication.read",
  /** Sends a communication to people outside the tenant, or retries a send. It cannot be undone. */
  communicationSend: "communication.communication.send",
} as const
