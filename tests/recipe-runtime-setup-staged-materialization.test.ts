import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { applyRecipeRuntimeSetup, recipeInputMountPathMap, rewriteInputMountPathArgs, type PreparedRecipeRuntimeSetup } from "../packages/cli/src/commands/recipe-runtime-setup.js"
import { executeRecipeWorkflowStep } from "../packages/cli/src/commands/recipe-run-workflow-evidence.js"
import type { Runtime, WorkspaceRecipe } from "../packages/runtime-core/src/public.js"

const calls: string[] = []
const inputMountSource = await mkdtemp(join(tmpdir(), "wp-codebox-input-mount-test-"))
await writeFile(join(inputMountSource, "phpunit.xml"), "<phpunit />")
const recipe: WorkspaceRecipe = {
  schema: "wp-codebox/workspace-recipe/v1",
  runtime: { backend: "wordpress-playground" },
  inputs: {
    mounts: [{
      source: inputMountSource,
      target: "/home/example/public_html",
      mode: "readonly",
    }],
  },
  workflow: { steps: [] },
}
const prepared: PreparedRecipeRuntimeSetup = {
  workspaceMounts: [],
  extraPlugins: [],
  dependencyOverlays: [],
  overlays: [],
  inputMountBaselinePaths: [],
  inputMountPathMap: recipeInputMountPathMap(recipe),
  stagedFiles: [{
    source: "/tmp/host-bundle",
    originalSource: "/tmp/host-bundle",
    sourceRef: "/tmp/host-bundle",
    target: "/workspace/example/bundles/runtime-agent",
    type: "directory",
    cleanupPaths: [],
    provenance: { type: "local", source: "/tmp/host-bundle" },
    metadata: { kind: "runtime-package-source" },
  }],
}

const runtime = {
  async info() { return { id: "runtime", backend: "wordpress-playground", environment: { kind: "wordpress" }, createdAt: new Date().toISOString(), status: "running" } },
  async mount(spec) {
    calls.push(`mount:${spec.target}`)
    if (spec.metadata?.originalTarget) {
      calls.push(`metadata:${spec.metadata.originalTarget}->${spec.metadata.canonicalTarget}`)
    }
  },
  async materializeStagedInputs(mounts) {
    assert.equal(this, runtime, "setup calls staged input materializer with runtime binding")
    calls.push(`materialize:${mounts.map((mount) => mount.target).join(",")}`)
    assert.deepEqual(mounts, [
      {
        type: "directory",
        source: inputMountSource,
        target: prepared.inputMountPathMap[0].canonicalTarget,
        mode: "readonly",
        metadata: {
          originalTarget: "/home/example/public_html",
          canonicalTarget: prepared.inputMountPathMap[0].canonicalTarget,
          canonicalizedTarget: true,
        },
      },
      {
        type: "directory",
        source: "/tmp/host-bundle",
        target: "/workspace/example/bundles/runtime-agent",
        mode: "readwrite",
        metadata: { kind: "runtime-package-source" },
      },
    ])
  },
  async materializeMounts() { throw new Error("setup should use materializeStagedInputs when available") },
  async execute(spec) { calls.push(`execute:${spec.command}`); throw new Error("setup should not execute commands in this fixture") },
  async observe() { throw new Error("unused") },
  async snapshot() { throw new Error("unused") },
  async collectArtifacts() { throw new Error("unused") },
  async destroy() {},
} satisfies Runtime

const phaseExecutor = {
  tracker: {
    complete(name: string) { calls.push(`phase.complete:${name}`) },
    async run<T>(name: string, _data: unknown, callback: () => Promise<T>) { calls.push(`phase.run:${name}`); return await callback() },
    list() { return [] },
  },
  async operation<T>(operation: string, promiseOrFactory: Promise<T> | (() => Promise<T>)) {
    calls.push(`operation:${operation}`)
    return await (typeof promiseOrFactory === "function" ? promiseOrFactory() : promiseOrFactory)
  },
}

try {
  await applyRecipeRuntimeSetup({ recipe, recipeDirectory: process.cwd(), runtime, prepared, phaseExecutor: phaseExecutor as never })
} finally {
  await rm(inputMountSource, { recursive: true, force: true })
}

const mountIndex = calls.indexOf("mount:/workspace/example/bundles/runtime-agent")
const inputMountIndex = calls.indexOf(`mount:${prepared.inputMountPathMap[0].canonicalTarget}`)
const materializeOperationIndex = calls.indexOf("operation:input.materialize")
const materializeIndex = calls.indexOf(`materialize:${prepared.inputMountPathMap[0].canonicalTarget},/workspace/example/bundles/runtime-agent`)
assert.ok(inputMountIndex >= 0, "input source is mounted")
assert.match(prepared.inputMountPathMap[0].canonicalTarget, /^\/tmp\/wp-codebox-inputs\/0-public_html-[a-f0-9]{12}$/)
assert.ok(calls.includes(`metadata:/home/example/public_html->${prepared.inputMountPathMap[0].canonicalTarget}`), "input mount metadata records original and canonical targets")
assert.ok(mountIndex >= 0, "staged source is mounted")
assert.ok(materializeOperationIndex > inputMountIndex, "materialization is scheduled after input mount")
assert.ok(materializeOperationIndex > mountIndex, "materialization is scheduled after staged mount")
assert.ok(materializeIndex > materializeOperationIndex, "materialization runs inside the setup phase before commands")
assert.equal(calls.some((call) => call.startsWith("execute:")), false)

const workflowRuntime = {
  async info() { return { id: "runtime", backend: "wordpress-playground", environment: { kind: "wordpress" }, createdAt: new Date().toISOString(), status: "running" } },
  async mount() { throw new Error("unused") },
  async execute(spec) {
    return {
      id: "workflow-step",
      command: spec.command,
      args: spec.args ?? [],
      exitCode: 0,
      stdout: "",
      stderr: "",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }
  },
  async observe() { throw new Error("unused") },
  async snapshot() { throw new Error("unused") },
  async collectArtifacts() { throw new Error("unused") },
  async destroy() {},
} satisfies Runtime

const workflowExecution = await executeRecipeWorkflowStep(workflowRuntime, {
  phase: "steps",
  index: 0,
  step: {
    command: "wordpress.phpunit",
    args: [
      "cwd=/home/example/public_html/bin/tests/foo",
      "test-root=/home/example/public_html/bin/tests/foo",
      "phpunit-xml=/home/example/public_html/bin/tests/foo/phpunit.xml",
      "note=this mentions /home/example/public_html/bin/tests/foo but is not a path value",
    ],
  },
}, process.cwd(), undefined, undefined, undefined, prepared.inputMountPathMap)

assert.deepEqual(workflowExecution.args, [
  `cwd=${prepared.inputMountPathMap[0].canonicalTarget}/bin/tests/foo`,
  `test-root=${prepared.inputMountPathMap[0].canonicalTarget}/bin/tests/foo`,
  `phpunit-xml=${prepared.inputMountPathMap[0].canonicalTarget}/bin/tests/foo/phpunit.xml`,
  "note=this mentions /home/example/public_html/bin/tests/foo but is not a path value",
])

assert.deepEqual(rewriteInputMountPathArgs(["cwd=/home/example/public_html/bin/tests/foo"], [
  { originalTarget: "/home/example/public_html", canonicalTarget: "/tmp/wp-codebox-inputs/root" },
  { originalTarget: "/home/example/public_html/bin/tests", canonicalTarget: "/tmp/wp-codebox-inputs/tests" },
]), ["cwd=/tmp/wp-codebox-inputs/tests/foo"])

console.log("recipe runtime setup staged materialization ok")
