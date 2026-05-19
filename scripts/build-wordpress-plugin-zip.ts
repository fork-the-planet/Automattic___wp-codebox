import { execFile } from "node:child_process"
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repoRoot = resolve(import.meta.dirname, "..")
const pluginSource = join(repoRoot, "packages", "wordpress-plugin")
const outputDirectory = join(pluginSource, "dist")
const outputZip = join(outputDirectory, "wp-codebox.zip")
const stagingRoot = await mkdtemp(join(tmpdir(), "wp-codebox-plugin-"))
const stagingPlugin = join(stagingRoot, "wp-codebox")

try {
  await mkdir(outputDirectory, { recursive: true })
  await mkdir(stagingPlugin, { recursive: true })
  await cp(join(pluginSource, "wp-codebox.php"), join(stagingPlugin, "wp-codebox.php"))
  await cp(join(pluginSource, "README.md"), join(stagingPlugin, "README.md"))
  await cp(join(pluginSource, "src"), join(stagingPlugin, "src"), { recursive: true })
  await rm(outputZip, { force: true })
  await execFileAsync("zip", ["-qr", outputZip, "wp-codebox"], { cwd: stagingRoot })
  console.log(`Built ${outputZip}`)
} finally {
  await rm(stagingRoot, { recursive: true, force: true })
}
