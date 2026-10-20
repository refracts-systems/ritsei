export { canonicalize } from "./canonical.ts"

/** The fields of `Fields` with `undefined` values removed, so optional keys are left absent. */
export type WithoutUndefined<Fields> = { [Key in keyof Fields]?: Exclude<Fields[Key], undefined> }

/** The fields of `Fields` with `null` and `undefined` values removed. */
export type WithoutNullish<Fields> = {
  [Key in keyof Fields]?: Exclude<Fields[Key], null | undefined>
}

/**
 * Drops `undefined` fields. Spreading the result into an object omits optional keys instead of
 * assigning `undefined`, which `Schema.optionalKey` and exact comparisons distinguish.
 */
export const omitUndefined = <Fields extends { readonly [Key in keyof Fields]: unknown }>(
  fields: Fields,
): WithoutUndefined<Fields> =>
  // SAFETY: the entries keep their keys and only lose values that are undefined.
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as WithoutUndefined<Fields>

/** Drops `null` and `undefined` fields; see {@link omitUndefined}. */
export const omitNullish = <Fields extends { readonly [Key in keyof Fields]: unknown }>(
  fields: Fields,
): WithoutNullish<Fields> =>
  // SAFETY: the entries keep their keys and only lose values that are null or undefined.
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined && value !== null),
  ) as WithoutNullish<Fields>

/** The declared keys of a record, typed as such (`Object.keys` only returns strings). */
export const typedKeys = <Owner extends { readonly [Name in keyof Owner]: unknown }>(
  owner: Owner,
) =>
  // SAFETY: the owner's type declares exactly these keys.
  Object.keys(owner) as Array<keyof Owner & string>

/** The entries of a record with their declared key type. */
export const typedEntries = <Key extends string, Value>(record: Readonly<Record<Key, Value>>) =>
  // SAFETY: the record's type declares exactly these keys.
  Object.entries(record) as Array<[Key, Value]>
