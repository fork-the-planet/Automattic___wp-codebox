import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")
const workspace = resolve(repoRoot, "artifacts", "browser-action-visual-compare-smoke")
const pluginDir = join(workspace, "browser-action-visual-fixture")
const recipePath = join(workspace, "recipe.json")
const artifactsRoot = join(workspace, "artifacts")

await rm(workspace, { recursive: true, force: true })
await mkdir(pluginDir, { recursive: true })

await writeFile(join(pluginDir, "browser-action-visual-fixture.php"), `<?php
/**
 * Plugin Name: Browser Action Visual Fixture
 */
add_action('template_redirect', function () {
    if ( ! isset( $_GET['wp_codebox_action_visual_fixture'] ) ) {
        return;
    }

    $variant = isset( $_GET['variant'] ) ? sanitize_key( $_GET['variant'] ) : 'source';
    $color   = 'candidate' === $variant ? '#2563eb' : '#dc2626';
    $label   = 'candidate' === $variant ? 'Expanded candidate state' : 'Compact source state';
    $width   = 'candidate' === $variant ? '260px' : '210px';
    nocache_headers();
    echo '<!doctype html><html><head><style>body{margin:0;padding:24px;font-family:sans-serif}.card{width:' . esc_attr( $width ) . ';height:96px;background:' . esc_attr( $color ) . ';color:white;font-size:20px;display:grid;place-items:center;transition:none}.card[data-ready="false"]{opacity:.2}</style></head><body><button id="activate" type="button">Activate</button><main id="panel" class="card" data-ready="false">Waiting</main><script>document.getElementById("activate").addEventListener("click", function () { var panel = document.getElementById("panel"); panel.dataset.ready = "true"; panel.textContent = ' . wp_json_encode( $label ) . '; });</script></body></html>';
    exit;
} );
`)

const sourceScreenshot = join(artifactsRoot, "files", "browser", "screenshot-source-state.png")
const candidateScreenshot = join(artifactsRoot, "files", "browser", "screenshot-candidate-state.png")
const sourceDomSnapshot = join(artifactsRoot, "files", "browser", "dom-snapshot-source-state.json")
const candidateDomSnapshot = join(artifactsRoot, "files", "browser", "dom-snapshot-candidate-state.json")

await writeFile(recipePath, `${JSON.stringify({
  schema: "wp-codebox/workspace-recipe/v1",
  inputs: {
    extraPlugins: [
      {
        source: "./browser-action-visual-fixture",
        pluginFile: "browser-action-visual-fixture/browser-action-visual-fixture.php",
        activate: true,
      },
    ],
  },
  workflow: {
    steps: [
      {
        command: "wordpress.browser-actions",
        args: [
          "url=/?wp_codebox_action_visual_fixture=1&variant=source",
          `steps-json=${JSON.stringify([
            { kind: "waitFor", selector: "#activate" },
            { kind: "click", selector: "#activate" },
            { kind: "waitFor", selector: '#panel[data-ready="true"]' },
            { kind: "screenshot", name: "source-state" },
          ])}`,
          "viewport=420x260",
          "capture=steps,errors,screenshot,dom-snapshot",
        ],
      },
      {
        command: "wordpress.browser-actions",
        args: [
          "url=/?wp_codebox_action_visual_fixture=1&variant=candidate",
          `steps-json=${JSON.stringify([
            { kind: "waitFor", selector: "#activate" },
            { kind: "click", selector: "#activate" },
            { kind: "waitFor", selector: '#panel[data-ready="true"]' },
            { kind: "screenshot", name: "candidate-state" },
          ])}`,
          "viewport=420x260",
          "capture=steps,errors,screenshot,dom-snapshot",
        ],
      },
      {
        command: "wordpress.visual-compare",
        args: [
          `source-screenshot=${sourceScreenshot}`,
          `candidate-screenshot=${candidateScreenshot}`,
          `source-dom-snapshot=${sourceDomSnapshot}`,
          `candidate-dom-snapshot=${candidateDomSnapshot}`,
          "source-label=source-action-state",
          "candidate-label=candidate-action-state",
          "threshold=0.1",
          "max-explanation-elements=20",
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
const sourceScreenshotPath = join(artifactDirectory, "files", "browser", "screenshot-source-state.png")
const candidateScreenshotPath = join(artifactDirectory, "files", "browser", "screenshot-candidate-state.png")
const sourceDomSnapshotPath = join(artifactDirectory, "files", "browser", "dom-snapshot-source-state.json")
const candidateDomSnapshotPath = join(artifactDirectory, "files", "browser", "dom-snapshot-candidate-state.json")
const explanationPath = join(artifactDirectory, "files", "browser", "visual-compare", "visual-explanation.json")
const summaryPath = join(artifactDirectory, "files", "browser", "visual-compare", "visual-diff.json")
const manifestPath = join(artifactDirectory, "manifest.json")

assert.equal(existsSync(sourceScreenshotPath), true, "source action screenshot should be captured")
assert.equal(existsSync(candidateScreenshotPath), true, "candidate action screenshot should be captured")
assert.equal(existsSync(sourceDomSnapshotPath), true, "source action DOM snapshot should be captured")
assert.equal(existsSync(candidateDomSnapshotPath), true, "candidate action DOM snapshot should be captured")
assert.equal(existsSync(explanationPath), true, "visual explanation should be emitted for action screenshot sidecars")

const sourceSnapshot = JSON.parse(await readFile(sourceDomSnapshotPath, "utf8")) as { schema: string; screenshot: string; step?: { name?: string }; summary: { capturedElements: number; truncated: boolean } }
assert.equal(sourceSnapshot.schema, "wp-codebox/browser-dom-snapshot/v1")
assert.equal(sourceSnapshot.screenshot, "files/browser/screenshot-source-state.png")
assert.equal(sourceSnapshot.step?.name, "source-state")
assert.ok(sourceSnapshot.summary.capturedElements > 0, "sidecar should include bounded DOM/style context")

const summary = JSON.parse(await readFile(summaryPath, "utf8")) as { status: string; source: { domSnapshot?: string }; candidate: { domSnapshot?: string }; files: { visualExplanation?: string }; limitations: string[] }
assert.equal(summary.status, "different")
assert.equal(summary.source.domSnapshot, sourceDomSnapshot)
assert.equal(summary.candidate.domSnapshot, candidateDomSnapshot)
assert.equal(summary.files.visualExplanation, "files/browser/visual-compare/visual-explanation.json")
assert.ok(summary.limitations.some((limitation) => limitation.includes("heuristic evidence")), "summary should document explanation limits")

const explanation = JSON.parse(await readFile(explanationPath, "utf8")) as {
  schema: string
  source: { label: string; capturedElements: number }
  candidate: { label: string; capturedElements: number }
  summary: { changedElements: number }
  changes: Array<{ path: string; changes: { text?: unknown; boundingBox?: unknown; styles?: Record<string, unknown> } }>
}
assert.equal(explanation.schema, "wp-codebox/visual-explanation/v1")
assert.equal(explanation.source.label, "source-action-state")
assert.equal(explanation.candidate.label, "candidate-action-state")
assert.ok(explanation.source.capturedElements > 0, "source explanation should include action-derived DOM context")
assert.ok(explanation.candidate.capturedElements > 0, "candidate explanation should include action-derived DOM context")
assert.ok(explanation.summary.changedElements > 0, "explanation should report action-derived state changes")
assert.ok(explanation.changes.some((change) => change.path.includes("main") && change.changes.text), "explanation should report text changes")
assert.ok(explanation.changes.some((change) => change.path.includes("main") && change.changes.styles?.["background-color"]), "explanation should report style changes")
assert.ok(explanation.changes.some((change) => change.path.includes("main") && change.changes.boundingBox), "explanation should report layout changes")

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: Array<{ path: string; kind: string }> }
assert.ok(manifest.files.some((file) => file.path === "files/browser/dom-snapshot-source-state.json" && file.kind === "browser-dom-snapshot"))
assert.ok(manifest.files.some((file) => file.path === "files/browser/dom-snapshot-candidate-state.json" && file.kind === "browser-dom-snapshot"))
assert.ok(manifest.files.some((file) => file.path === "files/browser/visual-compare/visual-explanation.json" && file.kind === "browser-visual-explanation"))

console.log(`Browser action visual compare smoke passed: ${artifactDirectory}`)

async function runCli(args: string[]): Promise<{ success?: boolean; artifacts?: { directory?: string }; error?: { message?: string } }> {
  const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => { stdout += chunk })
  child.stderr.on("data", (chunk) => { stderr += chunk })
  const code = await new Promise<number | null>((resolveCode) => child.on("close", resolveCode))
  if (code !== 0) {
    throw new Error(`CLI exited with ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`)
  }
  return JSON.parse(stdout)
}
