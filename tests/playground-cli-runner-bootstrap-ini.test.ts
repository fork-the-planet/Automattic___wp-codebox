import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { startPlaygroundCliServer, type PlaygroundCliModule } from "../packages/runtime-playground/src/playground-cli-runner.js"
import type { RuntimeCreateSpec } from "../packages/runtime-core/src/index.js"

const wordpressDirectory = await mkdtemp(join(tmpdir(), "wp-codebox-wordpress-source-"))
const artifactsDirectory = await mkdtemp(join(tmpdir(), "wp-codebox-artifacts-"))
const calls: Parameters<PlaygroundCliModule["runCLI"]>[0][] = []

const cliModule: PlaygroundCliModule = {
  async runCLI(options) {
    calls.push(options)
    return {
      serverUrl: "http://127.0.0.1:65535",
      playground: {
        async run() {
          return { text: "" }
        },
      },
      async [Symbol.asyncDispose]() {},
    }
  },
}

try {
  const spec: RuntimeCreateSpec = {
    backend: "wordpress-playground",
    environment: {
      version: "mounted-wordpress-source",
      phpVersion: "8.4",
      wordpressInstallMode: "do-not-attempt-installing",
      assets: { wordpressDirectory },
      blueprint: {},
    },
    policy: {
      network: "deny",
      filesystem: "readwrite-mounts",
      commands: ["wordpress.run-php"],
      secrets: "none",
      approvals: "never",
    },
    metadata: {
      recipe: {
        inputs: {
          pluginRuntime: {
            php: {
              iniEntries: { memory_limit: "512M" },
              bootstrapIniEntries: { "opcache.file_cache": "/tmp/opcache" },
            },
          },
        },
      },
    },
    artifactsDirectory,
  }

  const server = await startPlaygroundCliServer(spec, [], { cliModule })
  await server[Symbol.asyncDispose]()

  assert.equal(calls.length, 1)
  assert.equal(calls[0]["mount-before-install"]?.length, 2)
  assert.equal(calls[0]["mount-before-install"]?.[0]?.vfsPath, "/internal/shared")
  assert.deepEqual(calls[0]["mount-before-install"]?.[1], { hostPath: wordpressDirectory, vfsPath: "/wordpress" })
  assert.deepEqual(calls[0].mount, [])
  assert.equal(calls[0].workers, 6)
  assert.equal(calls[0].wordpressInstallMode, "do-not-attempt-installing")
  assert.deepEqual(calls[0].phpIniEntries, { memory_limit: "512M" })
  const sharedMount = calls[0]["mount-before-install"]?.[0]?.hostPath
  assert.equal(typeof sharedMount, "string")
  assert.match(await readFile(join(sharedMount as string, "php.ini"), "utf8"), /opcache\.file_cache = \/tmp\/opcache/)
  assert.match(await readFile(join(sharedMount as string, "auto_prepend_file.php"), "utf8"), /<\?php/)
  assert.equal((await stat(join(sharedMount as string, "mu-plugins"))).isDirectory(), true)
  assert.equal((await stat(join(sharedMount as string, "preload"))).isDirectory(), true)
} finally {
  await rm(wordpressDirectory, { recursive: true, force: true })
  await rm(artifactsDirectory, { recursive: true, force: true })
}

console.log("playground cli runner bootstrap ini ok")
