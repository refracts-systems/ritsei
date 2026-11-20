/**
 * Domain model port (ADR-0124, phase 0).
 *
 * A module declares an aggregate model here and never imports `@alchemy.run/domain` itself, so the
 * host (in-memory for stories, Effect Cluster at runtime) can change without touching a module.
 * The declaration factories are re-exported, not wrapped: they are generic class factories whose
 * types are the model shape, and a wrapper would only repeat them. The host choice is the part this
 * port owns: `Story` is the in-memory host; `framework/platform/domain-model/mod.ts` is the Effect
 * Cluster host.
 *
 * Decisions (phase 0, pending owner confirmation):
 *
 * - **Shape:** a RITSEI entry point that re-exports exactly the names a model uses.
 * - **Tenant scope and authorization** run in the RITSEI service before it sends a command, as
 *   they do today, so deny-by-default capability checks stay unchanged. `decide` sees only what
 *   the service passes in the command; a foreign tenant's aggregate is never addressed because the
 *   service builds the instance id from the caller's tenant. Alchemy middleware is not used for
 *   authorization.
 * - **Event schema policy:** a recorded event decodes forever. A change adds optional fields only;
 *   a change of meaning is a new event type. Never rename or remove an event or a field.
 *
 * No ERP module consumes this port yet; the first consumer lands in phase 1 (ADR-0091).
 */
export {
  Aggregate,
  Command,
  Event,
  Model,
  Policy,
  Projection,
  Query,
  Rejection,
  Saga,
  verify,
} from "@alchemy.run/domain"

export { Story } from "@alchemy.run/domain/Story"
