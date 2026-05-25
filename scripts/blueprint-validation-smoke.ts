import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repoRoot = resolve(import.meta.dirname, "..")
const tempDirectory = await mkdtemp(join(tmpdir(), "wp-codebox-blueprint-validation-"))
const artifactsDirectory = join(tempDirectory, "artifacts")
const blueprintPath = join(tempDirectory, "blueprint.json")

try {
  await writeFile(blueprintPath, `${JSON.stringify({ steps: [] }, null, 2)}\n`)

  const output = await runCliJson([
    "validate-blueprint",
    "--blueprint",
    blueprintPath,
    "--artifacts",
    artifactsDirectory,
    "--json",
  ])

  assert.equal(output.success, true)
  assert.equal(output.schema, "wp-codebox/blueprint-validation/v1")
  assert.equal(output.blueprintPath, blueprintPath)
  assert.equal(output.execution, undefined)
  assert.equal(output.runtime.backend, "wordpress-playground")
  assert.equal(output.runtime.status, "destroyed")
  assert.equal(output.artifacts.preview.status, "expired-on-completion")
  assert.equal(output.artifacts.preview.lifecycle, "destroyed-on-completion")

  const commands = await readFile(output.artifacts.commandsPath, "utf8")
  assert.equal(commands.trim(), "", "blueprint validation should not create a fake workflow command")

  const metadata = JSON.parse(await readFile(output.artifacts.metadataPath, "utf8"))
  assert.equal(metadata.context.task.kind, "blueprint-validation")
  assert.equal(metadata.context.task.blueprintPath, blueprintPath)
} finally {
  await rm(tempDirectory, { recursive: true, force: true })
}

async function runCliJson(args: string[]): Promise<any> {
  const { stdout } = await execFileAsync(process.execPath, ["packages/cli/dist/index.js", ...args], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 10,
  })
  return JSON.parse(stdout)
}
