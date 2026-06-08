import assert from "node:assert/strict"
import { agentSandboxRuntimeFailure } from "../packages/cli/src/recipe-evidence.ts"

const completedWithHistoricalProcessingMetadata = {
  parsed: {
    output: JSON.stringify({
      command: "agent-sandbox.run",
      agent_runtime: {
        success: true,
        result: {
          status: "completed",
          outputs: { upstream_action_url: "https://example.test/pr/1" },
          metadata: {
            drain_history: [{ job_status: "processing" }],
            child_jobs: [{ status: "processing" }],
          },
        },
      },
    }),
  },
} as any

const pendingRuntimeResult = {
  parsed: {
    output: JSON.stringify({
      command: "agent-sandbox.run",
      agent_runtime: {
        success: true,
        result: {
          status: "processing",
          completed: false,
          has_pending_tools: true,
        },
      },
    }),
  },
} as any

assert.equal(agentSandboxRuntimeFailure(completedWithHistoricalProcessingMetadata), undefined)
assert.equal(agentSandboxRuntimeFailure(pendingRuntimeResult)?.code, "agent_runtime_incomplete")

console.log("agent sandbox incomplete-scope smoke passed")
