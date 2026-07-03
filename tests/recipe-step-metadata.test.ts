import assert from "node:assert/strict"

import { normalizeRecipeRunSummary, validateWorkspaceRecipeJsonSchema, type WorkspaceRecipe } from "../packages/runtime-core/src/index.js"
import { RecipeRunTimeoutError } from "../packages/cli/src/commands/recipe-run-output.js"
import { recipeStepFailure, withRecipeExecutionPhase } from "../packages/cli/src/commands/recipe-run-workflow-evidence.js"

const recipe: WorkspaceRecipe = {
  schema: "wp-codebox/workspace-recipe/v1",
  workflow: {
    steps: [{ command: "host/fixture", args: [], metadata: { fixture: "alpha", matrixIndex: 2 } }],
  },
}

assert.equal(validateWorkspaceRecipeJsonSchema(recipe).valid, true)
assert.equal(validateWorkspaceRecipeJsonSchema({ ...recipe, workflow: { steps: [{ command: "host/fixture", metadata: [] }] } }).valid, false)

const execution = withRecipeExecutionPhase({ command: "host/fixture", args: [], exitCode: 0, stdout: "", stderr: "" }, "steps", 0, "host/fixture", undefined, recipe.workflow.steps[0]!.metadata)
assert.deepEqual(execution.recipeStepMetadata, { fixture: "alpha", matrixIndex: 2 })

const summary = normalizeRecipeRunSummary({
  success: true,
  schema: "wp-codebox/recipe-run/v1",
  executions: [execution],
})
assert.deepEqual(summary.commands[0]?.recipe_step_metadata, { fixture: "alpha", matrixIndex: 2 })

const startedAtMs = Date.UTC(2026, 0, 1, 0, 0, 0)
const timeout = new RecipeRunTimeoutError("workflow.steps[0]:host/fixture", 250, 250)
const wrapped = new Error("Recipe workflow steps[0] failed: timed out", { cause: timeout })
const failure = recipeStepFailure({ phase: "steps", index: 0, step: recipe.workflow.steps[0]! }, wrapped, startedAtMs, startedAtMs + 250)
assert.equal(failure.schema, "wp-codebox/recipe-step-failure/v1")
assert.equal(failure.phase, "steps")
assert.equal(failure.index, 0)
assert.equal(failure.command, "host/fixture")
assert.deepEqual(failure.metadata, { fixture: "alpha", matrixIndex: 2 })
assert.equal(failure.startedAt, "2026-01-01T00:00:00.000Z")
assert.equal(failure.finishedAt, "2026-01-01T00:00:00.250Z")
assert.equal(failure.durationMs, 250)
assert.equal(failure.classification, "timeout")
assert.equal(failure.timeoutMs, 250)

console.log("recipe step metadata contract ok")
