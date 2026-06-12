import { runCli } from "./cli-entry.js"
import { serializeError } from "./output.js"

export type CliRunner = (args: string[]) => Promise<number>

const UNSETTLED_COMMAND_MESSAGE = "WP Codebox CLI command did not settle before the Node.js event loop drained."

export function runCliEntrypoint(args: string[], runner: CliRunner = runCli): void {
  let settled = false
  const handleBeforeExit = () => {
    if (settled) {
      return
    }
    console.error(UNSETTLED_COMMAND_MESSAGE)
    process.exitCode = 1
  }

  process.once("beforeExit", handleBeforeExit)
  runner(args).then(
    (code) => {
      settled = true
      process.off("beforeExit", handleBeforeExit)
      process.exitCode = code
    },
    (error) => {
      settled = true
      process.off("beforeExit", handleBeforeExit)
      console.error(serializeError(error)?.message ?? String(error))
      process.exitCode = 1
    },
  )
}
