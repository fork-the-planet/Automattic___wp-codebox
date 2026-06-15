import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const cli = resolve(root, "packages/cli/dist/index.js")
const workspace = await mkdtemp(join(tmpdir(), "wp-codebox-activation-failure-artifacts-"))

try {
  const pluginSource = join(workspace, "failing-plugin")
  const artifacts = join(workspace, "artifacts")
  const recipePath = join(workspace, "recipe.json")
  await mkdir(pluginSource, { recursive: true })
  await writeFile(join(pluginSource, "failing-plugin.php"), `<?php
/**
 * Plugin Name: WP Codebox Activation Failure Smoke
 */
register_activation_hook(__FILE__, function () {
    throw new RuntimeException('activation failure smoke sentinel');
});
`)
  await writeFile(recipePath, `${JSON.stringify({
    schema: "wp-codebox/workspace-recipe/v1",
    runtime: {
      backend: "wordpress-playground",
      name: "recipe-run-activation-failure-artifacts-smoke",
      wp: "7.0",
      blueprint: { steps: [] },
    },
    inputs: {
      extra_plugins: [
        {
          source: pluginSource,
          slug: "failing-plugin",
          pluginFile: "failing-plugin/failing-plugin.php",
        },
      ],
    },
    workflow: {
      steps: [
        {
          command: "wordpress.run-php",
          args: ["code=<?php echo 'unreachable';"],
        },
      ],
    },
  }, null, 2)}\n`)

  const result = spawnSync(process.execPath, [
    cli,
    "recipe-run",
    "--recipe",
    recipePath,
    "--artifacts",
    artifacts,
    "--json",
  ], { cwd: root, encoding: "utf8" })

  assert.equal(result.status, 1, `recipe-run should fail activation; stdout: ${result.stdout}; stderr: ${result.stderr}`)
  assert.ok(result.stdout.trim(), `recipe-run should emit JSON output; stderr: ${result.stderr}`)
  const output = JSON.parse(result.stdout)
  assert.equal(output.schema, "wp-codebox/recipe-run/v1")
  assert.equal(output.success, false)
  assert.match(JSON.stringify(output.error), /activation failure smoke sentinel|Failed to activate extra plugin/i)
  assert.ok(output.artifacts?.directory, "activation failure should report a runtime artifact directory")

  const pointer = JSON.parse(await readFile(join(artifacts, "manifest.json"), "utf8"))
  assert.equal(pointer.schema, "wp-codebox/recipe-run-artifact-pointer/v1")
  assert.equal(pointer.commandStatus, "failed")
  assert.equal(pointer.failurePhase, "activate_plugins")
  assert.ok(pointer.paths?.runtimeManifest, "pointer should expose the failed runtime manifest")
  assert.ok(Array.isArray(pointer.diagnosticArtifacts), "pointer should expose diagnostic artifact refs")

  const failureDiagnostic = pointer.diagnosticArtifacts.find((artifact: { kind?: string }) => artifact.kind === "recipe-run-failure-diagnostics")
  assert.ok(failureDiagnostic, "pointer should expose recipe-run failure diagnostics")

  const diagnostics = JSON.parse(await readFile(join(artifacts, failureDiagnostic.path), "utf8"))
  assert.equal(diagnostics.schema, "wp-codebox/recipe-run-failure-diagnostics/v1")
  assert.equal(diagnostics.recipe.path, recipePath)
  assert.equal(diagnostics.recipe.inputs.extra_plugins[0].pluginFile, "failing-plugin/failing-plugin.php")
  assert.equal(diagnostics.recipe.inputs.secretEnv.length, 0)
  assert.equal(diagnostics.phaseEvidence.some((phase: { name: string; status: string }) => phase.name === "activate_plugins" && phase.status === "failed"), true)

  const runtimeManifest = JSON.parse(await readFile(join(artifacts, pointer.paths.runtimeManifest), "utf8"))
  const runtimeDiagnosticPath = failureDiagnostic.path.split("/").slice(1).join("/")
  assert.equal(runtimeManifest.files.some((file: { kind?: string; path?: string }) => file.kind === "recipe-run-failure-diagnostics" && file.path === runtimeDiagnosticPath), true)

  console.log("recipe run activation failure artifact smoke passed")
} finally {
  await rm(workspace, { recursive: true, force: true })
}
