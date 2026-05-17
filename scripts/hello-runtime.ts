import { basename, resolve } from "node:path"
import { createRuntime } from "@chubes4/sandbox-runtime-core"
import { createPlaygroundRuntimeBackend } from "@chubes4/sandbox-runtime-playground"

const input = process.argv[2]

if (!input) {
  console.error("Usage: npm run hello-runtime -- <plugin-or-fixture-directory>")
  process.exit(1)
}

const source = resolve(input)
const runtime = await createRuntime(
  {
    backend: "wordpress-playground",
    environment: {
      kind: "wordpress",
      name: "hello-runtime",
      version: "latest",
      blueprint: {
        steps: [],
      },
    },
    policy: {
      network: "deny",
      filesystem: "readwrite-mounts",
      commands: ["inspect-mounted-inputs"],
      secrets: "none",
      approvals: "never",
    },
  },
  createPlaygroundRuntimeBackend(),
)

console.log("Booted runtime: wordpress-playground")

await runtime.mount({
  type: "directory",
  source,
  target: `/wordpress/wp-content/plugins/${basename(source)}`,
  mode: "readwrite",
})

console.log(`Mounted: ${basename(source)}`)

const result = await runtime.execute({ command: "inspect-mounted-inputs" })
console.log(`Executed: ${result.command}`)

await runtime.observe({ type: "runtime-info" })
await runtime.observe({ type: "mounts" })

const artifacts = await runtime.collectArtifacts({ includeLogs: true, includeObservations: true })
console.log(`Collected artifacts: ${artifacts.directory}`)

await runtime.destroy()
console.log("Destroyed runtime")
