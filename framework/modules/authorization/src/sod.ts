import * as Schema from "effect/Schema"

export const SeparationOfDutiesInput = Schema.Struct({
  staticResult: Schema.Literals(["clear", "conflict", "unknown"]),
  dynamicResult: Schema.Literals(["clear", "conflict", "unknown"]),
})
export type SeparationOfDutiesInput = Schema.Schema.Type<typeof SeparationOfDutiesInput>

export const SeparationOfDutiesDecision = Schema.Struct({
  allowed: Schema.Boolean,
  result: Schema.Literals(["clear", "conflict", "unknown"]),
  reason: Schema.String,
})
export type SeparationOfDutiesDecision = Schema.Schema.Type<typeof SeparationOfDutiesDecision>

export const evaluateSeparationOfDuties = (
  input: SeparationOfDutiesInput,
): SeparationOfDutiesDecision => {
  if (input.staticResult === "conflict" || input.dynamicResult === "conflict") {
    return { allowed: false, result: "conflict", reason: "SEGREGATION_OF_DUTIES" }
  }
  if (input.staticResult === "unknown" || input.dynamicResult === "unknown") {
    return { allowed: false, result: "unknown", reason: "SEGREGATION_OF_DUTIES_UNKNOWN" }
  }
  return { allowed: true, result: "clear", reason: "SEGREGATION_OF_DUTIES_CLEAR" }
}
