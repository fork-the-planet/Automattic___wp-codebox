import { resolve } from "node:path"
import type { JsonValue } from "./host-tool-registry.js"

export type CommandJsonObject = Record<string, unknown>

export interface CommandOptionParseResult {
  options: Map<string, string | true>
  positionals: string[]
}

export function commandArg(name: string, value: string | number | boolean): string {
  return `${name}=${String(value)}`
}

export function commandJsonArg(name: string, value: unknown): string {
  return commandArg(name, encodeCommandJson(value))
}

export function commandStringListArg(name: string, values: readonly string[]): string {
  return commandArg(name, encodeCommandStringList(values))
}

export function commandArgValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

export function positiveIntegerCommandArg(args: readonly string[], name: string, fallback: number): number {
  const raw = commandArgValue(args, name)
  if (!raw) {
    return fallback
  }

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function nonNegativeIntegerCommandArg(args: readonly string[], name: string, fallback: number): number {
  const raw = commandArgValue(args, name)
  if (!raw) {
    return fallback
  }

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function booleanCommandArg(args: readonly string[], name: string, fallback = false): boolean {
  const raw = commandArgValue(args, name)
  if (!raw) {
    return fallback
  }

  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase())
}

export function strictBooleanCommandArg(args: readonly string[], name: string, fallback: boolean): boolean {
  const raw = commandArgValue(args, name)?.trim().toLowerCase()
  if (!raw) {
    return fallback
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false
  }
  throw new Error(`${name} must be true or false`)
}

export function encodeCommandJson(value: unknown): string {
  return JSON.stringify(value)
}

export function encodeCommandJsonObject(value: CommandJsonObject): string {
  return encodeCommandJson(value)
}

export function parseCommandJson(raw: string, label = "JSON argument"): unknown {
  try {
    return JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} must be valid JSON: ${message}`)
  }
}

export function parseCommandInput(args: readonly string[], explicitName = "input-json"): JsonValue {
  const explicit = commandArgValue(args, explicitName)
  if (explicit !== undefined) {
    return parseCommandJson(explicit, explicitName) as JsonValue
  }

  const input: Record<string, string> = {}
  for (const arg of args) {
    const separator = arg.indexOf("=")
    if (separator > 0) {
      input[arg.slice(0, separator)] = arg.slice(separator + 1)
    }
  }
  return input
}

export function resolveCommandPath(pathValue: string, baseDir = process.cwd()): string {
  const trimmed = pathValue.trim()
  if (!trimmed) {
    throw new Error("Command path must be non-empty")
  }
  return resolve(baseDir, trimmed)
}

export function parseCommandJsonObject(raw: string | undefined, label = "JSON argument", fallback: CommandJsonObject = {}): CommandJsonObject {
  if (!raw) {
    return fallback
  }

  const parsed = parseCommandJson(raw, label)
  if (!isCommandJsonObject(parsed)) {
    throw new Error(`${label} must be a JSON object`)
  }

  return parsed
}

export function parseCommandJsonArray(raw: string | undefined, label = "JSON argument", fallback: unknown[] = []): unknown[] {
  if (!raw) {
    return fallback
  }

  const parsed = parseCommandJson(raw, label)
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array`)
  }

  return parsed
}

export function encodeCommandStringList(values: readonly string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).join(",")
}

export function parseCommandStringList(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((item) => item.trim()).filter(Boolean)
}

export function parseCommandOptions(args: readonly string[], flags: ReadonlySet<string> = new Set()): CommandOptionParseResult {
  const options = new Map<string, string | true>()
  const positionals: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }

    const equals = arg.indexOf("=")
    const name = equals === -1 ? arg : arg.slice(0, equals)
    if (flags.has(name)) {
      if (equals !== -1) {
        throw new Error(`${name} does not accept a value`)
      }
      options.set(name, true)
      continue
    }

    const value = equals === -1 ? args[index + 1] : arg.slice(equals + 1)
    if (value === undefined) {
      throw new Error(`Missing value for option: ${name}`)
    }
    options.set(name, value)
    if (equals === -1) {
      index += 1
    }
  }

  return { options, positionals }
}

function isCommandJsonObject(value: unknown): value is CommandJsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
