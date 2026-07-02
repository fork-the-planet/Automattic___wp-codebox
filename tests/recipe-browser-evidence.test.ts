import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { recipeBrowserEvidence } from "../packages/cli/src/commands/recipe-run-workflow-evidence.js"

const root = mkdtempSync(join(tmpdir(), "wp-codebox-recipe-browser-evidence-"))
const manifestPath = join(root, "manifest.json")
writeFileSync(manifestPath, JSON.stringify({
  schema: "wp-codebox/artifact-manifest/v1",
  files: [
    { path: "files/browser/visual-compare/source.png", kind: "browser-visual-source-screenshot", contentType: "image/png", sha256: "source-digest" },
    { path: "files/browser/visual-compare/candidate.png", kind: "browser-visual-candidate-screenshot", contentType: "image/png", sha256: "candidate-digest" },
    { path: "files/browser/visual-compare/diff.png", kind: "browser-visual-diff-screenshot", contentType: "image/png", sha256: "diff-digest" },
    { path: "files/browser/visual-compare/visual-diff.json", kind: "browser-visual-diff", contentType: "application/json", sha256: "visual-diff-digest" },
    { path: "files/browser/visual-compare/summary.json", kind: "browser-summary", contentType: "application/json", sha256: "summary-digest" },
  ],
}, null, 2))

const evidence = await recipeBrowserEvidence({ manifestPath } as never, [{
  id: "visual-compare-1",
  command: "wordpress.visual-compare",
  recipeCommand: "wordpress.visual-compare",
  recipePhase: "steps",
  recipeStepIndex: 2,
  args: [],
  exitCode: 0,
  stdout: `${JSON.stringify({
    schema: "wp-codebox/visual-compare/v1",
    requestedUrl: "https://source.example/",
    finalUrl: "https://candidate.example/",
    files: {
      sourceScreenshot: "files/browser/visual-compare/source.png",
      candidateScreenshot: "files/browser/visual-compare/candidate.png",
      diffScreenshot: "files/browser/visual-compare/diff.png",
      visualDiff: "files/browser/visual-compare/visual-diff.json",
      summary: "files/browser/visual-compare/summary.json",
    },
    summary: {
      visualCompare: {
        mismatchPixels: 42,
        totalPixels: 1000,
        dimensionMismatch: false,
      },
    },
  })}\n`,
  stderr: "",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:00.001Z",
}], undefined)

assert.equal(evidence.length, 1)
assert.equal(evidence[0]?.command, "wordpress.visual-compare")
assert.equal(evidence[0]?.phase, "steps")
assert.equal(evidence[0]?.index, 2)
assert.equal(evidence[0]?.files.sourceScreenshot?.path, "files/browser/visual-compare/source.png")
assert.equal(evidence[0]?.files.sourceScreenshot?.kind, "browser-visual-source-screenshot")
assert.equal(evidence[0]?.files.candidateScreenshot?.path, "files/browser/visual-compare/candidate.png")
assert.equal(evidence[0]?.files.diffScreenshot?.path, "files/browser/visual-compare/diff.png")
assert.equal(evidence[0]?.files.visualDiff?.path, "files/browser/visual-compare/visual-diff.json")
assert.equal(evidence[0]?.summaryFile?.path, "files/browser/visual-compare/summary.json")
