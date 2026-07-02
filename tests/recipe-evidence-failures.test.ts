import assert from "node:assert/strict"

import { recipeVerifyStepFailure } from "../packages/cli/src/recipe-evidence.js"

assert.equal(recipeVerifyStepFailure([{ exitCode: 0, recipePhase: "steps", recipeCommand: "wordpress.run-workload" }]), undefined)
assert.equal(recipeVerifyStepFailure([{ exitCode: 1, recipePhase: "steps", recipeCommand: "wordpress.collect-workload-result", recipeAdvisory: true }]), undefined)

const failedWorkflow = recipeVerifyStepFailure([{ exitCode: 1, recipePhase: "steps", recipeCommand: "wordpress.collect-workload-result" }])
assert.equal(failedWorkflow?.code, "verify-step-failed")
assert.match(failedWorkflow?.message ?? "", /wordpress\.collect-workload-result failed with exit code 1/)

const failedAfter = recipeVerifyStepFailure([{ exitCode: 2, recipePhase: "after", recipeCommand: "wordpress.run-php" }])
assert.equal(failedAfter?.code, "verify-step-failed")
assert.match(failedAfter?.message ?? "", /wordpress\.run-php failed with exit code 2/)

console.log("recipe evidence failures ok")
