import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")
const workspace = resolve(repoRoot, "artifacts", "editor-open-artifact-smoke")
const recipePath = join(workspace, "recipe.json")
const artifactsRoot = join(workspace, "artifacts")

await rm(workspace, { recursive: true, force: true })
await mkdir(workspace, { recursive: true })

await writeFile(recipePath, `${JSON.stringify({
  schema: "wp-codebox/workspace-recipe/v1",
  workflow: {
    steps: [
      {
        command: "wordpress.editor-open",
        args: [
          "target=post-new",
          "post-type=post",
          "wait-timeout=30s",
          "capture=steps,console,errors,html,screenshot,editor-state",
        ],
      },
    ],
  },
  artifacts: {
    directory: artifactsRoot,
  },
}, null, 2)}\n`)

const output = await runCli([
  "packages/cli/dist/index.js",
  "recipe-run",
  "--recipe",
  recipePath,
  "--json",
])

assert.equal(output.success, true, output.error?.message ?? "recipe-run failed")
assert.ok(output.artifacts?.directory, "recipe-run should return an artifact directory")

const artifactDirectory = output.artifacts.directory
const stepsPath = join(artifactDirectory, "files", "browser", "editor-steps.jsonl")
const consolePath = join(artifactDirectory, "files", "browser", "editor-console.jsonl")
const errorsPath = join(artifactDirectory, "files", "browser", "editor-errors.jsonl")
const htmlPath = join(artifactDirectory, "files", "browser", "editor-snapshot.html")
const screenshotPath = join(artifactDirectory, "files", "browser", "editor-screenshot.png")
const editorStatePath = join(artifactDirectory, "files", "browser", "editor-state.json")
const summaryPath = join(artifactDirectory, "files", "browser", "editor-summary.json")
const manifestPath = join(artifactDirectory, "manifest.json")
const reviewPath = join(artifactDirectory, "files", "review.json")

assert.equal(existsSync(stepsPath), true, "editor step trace should be captured")
assert.equal(existsSync(consolePath), true, "editor console trace should be captured")
assert.equal(existsSync(errorsPath), true, "editor error trace should be captured")
assert.equal(existsSync(htmlPath), true, "editor DOM snapshot should be captured")
assert.equal(existsSync(screenshotPath), true, "editor screenshot should be captured")
assert.equal(existsSync(editorStatePath), true, "editor store state should be captured")
assert.equal(existsSync(summaryPath), true, "editor summary should be captured")

const stepsLog = await readFile(stepsPath, "utf8")
assert.match(stepsLog, /"kind":"navigate"/)
assert.match(stepsLog, /"kind":"waitFor"/)
assert.match(stepsLog, /"status":"ok"/)

const summary = JSON.parse(await readFile(summaryPath, "utf8")) as {
  schema: string
  target: { kind: string; postType?: string }
  files: { steps?: string; editorState?: string; html?: string; screenshot?: string; summary: string }
  summary: { steps: number; replayability: string; htmlSnapshot: boolean; editor?: { postType?: string; storesAvailable: boolean } }
}
assert.equal(summary.schema, "wp-codebox/editor-open/v1")
assert.equal(summary.target.kind, "post-new")
assert.equal(summary.target.postType, "post")
assert.equal(summary.files.steps, "files/browser/editor-steps.jsonl")
assert.equal(summary.files.editorState, "files/browser/editor-state.json")
assert.equal(summary.files.html, "files/browser/editor-snapshot.html")
assert.equal(summary.files.screenshot, "files/browser/editor-screenshot.png")
assert.equal(summary.files.summary, "files/browser/editor-summary.json")
assert.equal(summary.summary.steps, 2)
assert.equal(summary.summary.replayability, "artifact-backed")
assert.equal(summary.summary.htmlSnapshot, true)
assert.equal(summary.summary.editor?.postType, "post")
assert.equal(summary.summary.editor?.storesAvailable, true)

const editorState = JSON.parse(await readFile(editorStatePath, "utf8")) as {
  schema: string
  storesAvailable: boolean
  post?: { type?: string }
  blocks?: Array<{ name: string }>
}
assert.equal(editorState.schema, "wp-codebox/editor-state/v1")
assert.equal(editorState.storesAvailable, true)
assert.equal(editorState.post?.type, "post")
assert.ok(Array.isArray(editorState.blocks), "editor state should include a blocks array")

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: Array<{ path: string; kind: string }> }
assert.ok(manifest.files.some((file) => file.path === "files/browser/editor-state.json" && file.kind === "browser-editor-state"))
assert.ok(manifest.files.some((file) => file.path === "files/browser/editor-summary.json" && file.kind === "browser-summary"))

const review = JSON.parse(await readFile(reviewPath, "utf8")) as { browser?: { probes?: Array<{ editorState?: string; html?: string; screenshot?: string; summaryFile?: string }> } }
assert.equal(review.browser?.probes?.[0]?.editorState, "files/browser/editor-state.json")
assert.equal(review.browser?.probes?.[0]?.html, "files/browser/editor-snapshot.html")
assert.equal(review.browser?.probes?.[0]?.screenshot, "files/browser/editor-screenshot.png")
assert.equal(review.browser?.probes?.[0]?.summaryFile, "files/browser/editor-summary.json")

console.log(`Editor open artifact smoke passed: ${artifactDirectory}`)

async function runCli(args: string[]): Promise<any> {
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
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

  const exitCode = await new Promise<number | null>((resolveExit) => child.once("exit", (code) => resolveExit(code)))
  assert.equal(exitCode, 0, `CLI exited with ${exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`)
  return JSON.parse(stdout)
}
