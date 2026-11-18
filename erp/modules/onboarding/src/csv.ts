import * as Effect from "effect/Effect"

/** The lowercase hexadecimal SHA-256 of the text's UTF-8 bytes. */
export const sha256Hex = (text: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))

    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  })

interface Field {
  readonly value: string
  /** The index just after the field, at its terminator or the end of the text. */
  readonly next: number
}

/** Reads a quoted field whose opening quote is at `start`, or `undefined` if it never closes. */
const readQuoted = (source: string, start: number): Field | undefined => {
  let value = ""
  let index = start + 1

  while (index < source.length) {
    const character = source.charAt(index)

    if (character !== '"') {
      value += character
      index += 1
    } else if (source.charAt(index + 1) === '"') {
      value += '"'
      index += 2
    } else return { value, next: index + 1 }
  }

  return undefined
}

const isTerminator = (character: string) =>
  character === "," || character === "\n" || character === "\r"

/** Reads one field, quoted or not. A stray quote, or text after a closing quote, is damage. */
const readField = (source: string, start: number): Field | undefined => {
  if (source.charAt(start) === '"') {
    const quoted = readQuoted(source, start)
    const after = quoted === undefined ? "" : source.charAt(quoted.next)

    return quoted !== undefined && (after === "" || isTerminator(after)) ? quoted : undefined
  }

  let end = start

  while (end < source.length && !isTerminator(source.charAt(end))) {
    if (source.charAt(end) === '"') return undefined
    end += 1
  }

  return { value: source.slice(start, end), next: end }
}

/**
 * Parses RFC 4180 CSV: quoted fields with doubled quotes, CRLF, LF, or CR line ends, and an
 * optional byte order mark. Blank lines are skipped. Returns `undefined` for an unterminated quote
 * or a quote inside an unquoted field, so a damaged export is rejected rather than guessed at.
 */
export const parseCsv = (text: string): ReadonlyArray<ReadonlyArray<string>> | undefined => {
  const source = text.startsWith("﻿") ? text.slice(1) : text
  const records: Array<ReadonlyArray<string>> = []
  let record: Array<string> = []
  let index = 0

  const endRecord = () => {
    if (record.length > 1 || record[0] !== "") records.push(record)
    record = []
  }

  while (index < source.length) {
    const field = readField(source, index)

    if (field === undefined) return undefined
    record.push(field.value)
    index = field.next

    if (source.charAt(index) === ",") {
      index += 1

      if (index >= source.length) record.push("")
      continue
    }

    index += source.startsWith("\r\n", index) ? 2 : 1
    endRecord()
  }

  if (record.length > 0) endRecord()

  return records
}
