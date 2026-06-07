import { durationArg, strictBooleanArg, viewportArg } from "../packages/runtime-playground/src/command-args.js"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn()
  } catch {
    return
  }
  throw new Error(message)
}

function main(): void {
  assert(strictBooleanArg(["flag=true"], "flag", false) === true, "strict boolean parses true")
  assert(strictBooleanArg(["flag=0"], "flag", true) === false, "strict boolean parses false")
  assert(strictBooleanArg([], "flag", true) === true, "strict boolean preserves fallback")
  assertThrows(() => strictBooleanArg(["flag=maybe"], "flag", false), "strict boolean rejects invalid values")

  assert(durationArg(["timeout=500ms"], "timeout", 0) === 500, "duration parses milliseconds")
  assert(durationArg(["timeout=1.5s"], "timeout", 0) === 1500, "duration parses seconds")
  assert(durationArg([], "timeout", 250) === 250, "duration preserves fallback")
  assertThrows(() => durationArg(["timeout=5m"], "timeout", 0), "duration rejects unsupported units")

  const viewport = viewportArg(["viewport=390x844"], "viewport")
  assert(viewport?.width === 390 && viewport.height === 844, "viewport parses width and height")
  assert(viewportArg([], "viewport") === undefined, "viewport preserves empty fallback")
  assertThrows(() => viewportArg(["viewport=0x844"], "viewport"), "viewport rejects non-positive dimensions")
}

main()
