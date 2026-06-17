import { booleanCommandArg, commandArgValue, nonNegativeIntegerCommandArg, parseCommandJsonArray, parseCommandJsonObject, parseCommandStringList, positiveIntegerCommandArg, strictBooleanCommandArg } from "@automattic/wp-codebox-core"

export function argValue(args: string[], name: string): string | undefined {
  return commandArgValue(args, name)
}

export function positiveIntegerArg(args: string[], name: string, fallback: number): number {
  return positiveIntegerCommandArg(args, name, fallback)
}

export function nonNegativeIntegerArg(args: string[], name: string, fallback: number): number {
  return nonNegativeIntegerCommandArg(args, name, fallback)
}

export function booleanArg(args: string[], name: string, fallback = false): boolean {
  return booleanCommandArg(args, name, fallback)
}

export function strictBooleanArg(args: string[], name: string, fallback: boolean): boolean {
  return strictBooleanCommandArg(args, name, fallback)
}

export function durationArg(args: string[], name: string, fallbackMs: number): number {
  const raw = argValue(args, name)?.trim()
  if (!raw) {
    return fallbackMs
  }

  const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s)$/)
  if (!match) {
    throw new Error(`${name} must be a duration like 500ms or 2s`)
  }

  const value = Number.parseFloat(match[1])
  return Math.max(0, Math.round(match[2] === "ms" ? value : value * 1000))
}

export function viewportArg(args: string[], name: string): { width: number; height: number } | undefined {
  const raw = argValue(args, name)?.trim()
  if (!raw) {
    return undefined
  }

  const match = raw.match(/^(\d+)x(\d+)$/i)
  if (!match) {
    throw new Error(`${name} must use <width>x<height>, for example 390x844: ${raw}`)
  }

  const width = Number.parseInt(match[1] ?? "", 10)
  const height = Number.parseInt(match[2] ?? "", 10)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`${name} width and height must be positive integers: ${raw}`)
  }

  return { width, height }
}

export function commaListArg(args: string[], name: string): string[] {
  return parseCommandStringList(argValue(args, name))
}

export function jsonObjectArg(args: string[], name: string): Record<string, unknown> {
  return parseCommandJsonObject(argValue(args, name), name)
}

export function jsonArrayArg(args: string[], name: string): unknown[] {
  return parseCommandJsonArray(argValue(args, name), name)
}

export function isSafeEnvName(name: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(name)
}

export function normalizePhpCode(code: string): string {
  return code.trimStart().startsWith("<?php") ? code : `<?php\n${code}`
}

export function phpBody(code: string): string {
  return code.trimStart().replace(/^<\?php\s*/, "")
}
