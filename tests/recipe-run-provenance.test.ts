import assert from "node:assert/strict"
import { normalizeRecipeRunSummary } from "@automattic/wp-codebox-core"
import { executeRecipeWorkflowStep } from "../packages/cli/src/commands/recipe-run-workflow-evidence.js"

const provenance = {
  schema: "wp-codebox/recipe-run-provenance/v1",
  packages: {
    schema: "wp-codebox/package-provenance/v1",
    wpCodebox: { name: "wp-codebox", version: "0.11.0" },
    cli: { name: "@automattic/wp-codebox-cli", version: "0.11.0" },
    runtimeCore: { name: "@automattic/wp-codebox-core", version: "0.11.0" },
  },
  recipe: {
    path: "/tmp/recipe.json",
    sha256: "source-digest",
    effectiveSha256: "effective-digest",
    effectiveRecipeRef: { path: "runtime/files/recipe-run-effective-recipe.json", kind: "recipe-run-effective-recipe", contentType: "application/json", sha256: "effective-digest" },
  },
}

const summary = normalizeRecipeRunSummary({
  success: false,
  schema: "wp-codebox/recipe-run/v1",
  recipePath: "/tmp/recipe.json",
  provenance,
  executions: [],
  error: { message: "failed" },
})

assert.deepEqual(summary.provenance, provenance)
assert.deepEqual(summary.metadata.package_provenance, provenance.packages)

const calls: Array<{ command: string; args?: string[] }> = []
const runtime = {
  execute: async (spec: { command: string; args?: string[] }) => {
    calls.push(spec)
    return {
      id: "exec-1",
      command: spec.command,
      args: spec.args ?? [],
      exitCode: 0,
      stdout: "",
      stderr: "",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:00.001Z",
    }
  },
}

const execution = await executeRecipeWorkflowStep(runtime as never, {
  phase: "steps",
  index: 0,
  step: { command: "wordpress.wp-cli", args: ["--path=/home/example/public_html", "option", "get", "siteurl"] },
}, "/tmp", undefined, undefined, undefined, [
  { originalTarget: "/home/example/public_html", canonicalTarget: "/tmp/wp-codebox-inputs/root" },
])

assert.deepEqual(calls[0]?.args, ["--path=/tmp/wp-codebox-inputs/root", "option", "get", "siteurl"])
assert.equal(execution.recipeArgs?.schema, "wp-codebox/recipe-workflow-args/v1")
assert.equal(execution.recipeArgs?.rewritten, true)
assert.deepEqual(execution.recipeArgs?.original, ["--path=/home/example/public_html", "option", "get", "siteurl"])
assert.deepEqual(execution.recipeArgs?.effective, ["--path=/tmp/wp-codebox-inputs/root", "option", "get", "siteurl"])

console.log("recipe run provenance ok")
