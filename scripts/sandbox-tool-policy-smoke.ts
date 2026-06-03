import assert from "node:assert/strict"
import {
  normalizeSandboxToolPolicySnapshot,
  sandboxAllowedRuntimeToolIds,
  validateSandboxToolPolicySnapshot,
} from "@automattic/wp-codebox-core"

const datamachineShapedSnapshot = {
  schema: "wp-codebox/sandbox-tool-policy/v1",
  version: 1,
  tools: [
    {
      id: "datamachine/workspace-read",
      runtime_tool_id: "workspace_read",
      execution_location: "sandbox",
      transport_visibility: "sandbox",
      allowed: true,
      risk: "read",
      action: "workspace.read",
    },
    {
      id: "datamachine/workspace-git-push",
      runtime_tool_id: "workspace_git_push",
      execution_location: "parent",
      transport_visibility: "parent",
      allowed: false,
      risk: "write-remote",
      action: "git.push",
    },
  ],
  metadata: { source: "data-machine-smoke" },
}

const genericSnapshot = {
  schema: "wp-codebox/sandbox-tool-policy/v1",
  version: 1,
  tools: [
    {
      id: "workspace.read",
      runtime_tool_id: "workspace_read",
      execution_location: "sandbox",
      transport_visibility: "both",
      allowed: true,
      risk: "read",
      action: "workspace.read",
    },
    {
      id: "deploy.production",
      runtime_tool_id: "deploy_production",
      execution_location: "parent",
      transport_visibility: "hidden",
      allowed: false,
      risk: "deploy",
      action: "deploy.production",
    },
  ],
  metadata: { source: "generic-smoke" },
}

assert.equal(validateSandboxToolPolicySnapshot(datamachineShapedSnapshot).valid, true)
assert.deepEqual(sandboxAllowedRuntimeToolIds(normalizeSandboxToolPolicySnapshot(datamachineShapedSnapshot)), ["workspace_read"])

assert.equal(validateSandboxToolPolicySnapshot(genericSnapshot).valid, true)
assert.deepEqual(sandboxAllowedRuntimeToolIds(normalizeSandboxToolPolicySnapshot(genericSnapshot)), ["workspace_read"])

assert.equal(validateSandboxToolPolicySnapshot({}).valid, false)
