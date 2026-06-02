import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const workspace = await mkdtemp(join(tmpdir(), "wp-codebox-playground-boot-failure-"))
const blocker = createServer()

try {
  const port = await listenOnRandomPort(blocker)
  const recipePath = join(workspace, "recipe.json")
  await writeFile(recipePath, `${JSON.stringify({
    schema: "wp-codebox/workspace-recipe/v1",
    runtime: { wp: "7.0" },
    workflow: {
      steps: [{ command: "wordpress.run-php", args: ["code=<?php echo 'unreachable';"] }],
    },
  }, null, 2)}\n`)

  const startedAt = Date.now()
  const child = spawn(process.execPath, [
    "packages/cli/dist/index.js",
    "recipe-run",
    "--recipe",
    recipePath,
    "--preview-port",
    String(port),
    "--json",
  ], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  })

  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString()
  })

  const timeout = setTimeout(() => {
    child.kill("SIGKILL")
  }, 15_000)
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.once("close", (code, signal) => resolveExit({ code, signal }))
  })
  clearTimeout(timeout)

  assert.notEqual(exit.signal, "SIGKILL", `recipe-run hung after Playground boot failure; stdout: ${stdout}; stderr: ${stderr}`)
  assert.equal(exit.code, 1, `recipe-run should fail; stdout: ${stdout}; stderr: ${stderr}`)
  assert.ok(Date.now() - startedAt < 15_000, "recipe-run should exit before the watchdog timeout")

  const output = JSON.parse(stdout)
  assert.equal(output.schema, "wp-codebox/recipe-run/v1")
  assert.equal(output.success, false)
  assert.match(output.error?.message ?? "", /preview-port|EADDRINUSE|unavailable/i, `Unexpected error output: ${stdout}; stderr: ${stderr}`)

  console.log("Recipe Playground deterministic boot failure smoke passed")
} finally {
  await closeServer(blocker)
  await rm(workspace, { recursive: true, force: true })
}

async function listenOnRandomPort(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(0, "127.0.0.1", () => resolveListen())
  })
  const address = server.address()
  assert.ok(address && typeof address === "object", "Expected TCP server to expose an assigned port")
  return address.port
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) {
    return
  }
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
}
