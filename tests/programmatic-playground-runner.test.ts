import assert from "node:assert/strict"
import { shouldUseProgrammaticPlaygroundRunner } from "../packages/runtime-playground/src/playground-cli-runner.js"
import type { RuntimeCreateSpec } from "../packages/runtime-core/src/index.js"

const spec: RuntimeCreateSpec = {
  backend: "wordpress-playground",
  environment: {
    version: "mounted-wordpress-source",
    phpVersion: "8.4",
    wordpressInstallMode: "do-not-attempt-installing",
    assets: { wordpressDirectory: "/tmp/wordpress" },
    blueprint: {},
  },
  policy: {
    network: "deny",
    filesystem: "readwrite-mounts",
    commands: ["wordpress.run-php", "wordpress.wp-cli"],
    secrets: "none",
    approvals: "never",
  },
  metadata: {
    recipe: {
      inputs: {
        pluginRuntime: {
          php: {
            bootstrapIniEntries: { memory_limit: "384M" },
          },
        },
      },
    },
  },
}

assert.equal(shouldUseProgrammaticPlaygroundRunner(spec), true)
assert.equal(shouldUseProgrammaticPlaygroundRunner({ ...spec, environment: { ...spec.environment, assets: {} } }), false)
assert.equal(shouldUseProgrammaticPlaygroundRunner({ ...spec, metadata: {} }), false)
assert.equal(shouldUseProgrammaticPlaygroundRunner(spec, {
  cliModule: {
    async runCLI() {
      throw new Error("not called")
    },
  },
}), false)

console.log("programmatic playground runner opt-in boundary ok")
