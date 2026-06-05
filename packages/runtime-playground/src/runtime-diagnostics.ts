import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { MountSpec } from "@automattic/wp-codebox-core"
import type { PlaygroundCliServer } from "./preview-server.js"
import { extractPhpunitFailureMessage } from "./playground-command-errors.js"

export async function persistPluginPhpunitResult(server: PlaygroundCliServer, vfsPath: string, artifactRoot: string): Promise<void> {
  await persistPhpunitResult(server, vfsPath, join(artifactRoot, "files", "phpunit", ".pg-test-result.txt"))
}

export async function persistCorePhpunitResult(server: PlaygroundCliServer, vfsPath: string, artifactRoot: string): Promise<void> {
  await persistPhpunitResult(server, vfsPath, join(artifactRoot, "files", "core-phpunit", ".pg-test-result.txt"))
}

export async function persistPhpunitResult(server: PlaygroundCliServer, vfsPath: string, hostPath: string): Promise<void> {
  if (!server.playground.readFileAsText) {
    return
  }

  try {
    const contents = await server.playground.readFileAsText(vfsPath)
    await mkdir(dirname(hostPath), { recursive: true })
    await writeFile(hostPath, contents)
  } catch {
    // The structured result is best-effort; preserve the command outcome if copying fails.
  }
}

export async function readPluginPhpunitDiagnostic(server: PlaygroundCliServer, vfsPath: string): Promise<string | undefined> {
  return readPhpunitDiagnostic(server, vfsPath)
}

export async function readCorePhpunitDiagnostic(server: PlaygroundCliServer, vfsPath: string): Promise<string | undefined> {
  return readPhpunitDiagnostic(server, vfsPath)
}

async function readPhpunitDiagnostic(server: PlaygroundCliServer, vfsPath: string): Promise<string | undefined> {
  if (!server.playground.readFileAsText) {
    return undefined
  }

  let contents: string
  try {
    contents = await server.playground.readFileAsText(vfsPath)
  } catch {
    return undefined
  }

  return extractPhpunitFailureMessage(contents)
}

export async function persistVfsDiagnosticFile(server: PlaygroundCliServer, vfsPath: string, mounts: MountSpec[]): Promise<void> {
  await persistVfsDiagnosticFileToHost(server, vfsPath, vfsPath, mounts)
}

export async function persistVfsDiagnosticFileToHost(server: PlaygroundCliServer, sourceVfsPath: string, hostVfsPath: string, mounts: MountSpec[]): Promise<void> {
  if (!server.playground.readFileAsText) {
    return
  }

  const hostPath = hostPathForVfsPath(hostVfsPath, mounts)
  if (!hostPath) {
    return
  }

  try {
    const contents = await server.playground.readFileAsText(sourceVfsPath)
    await mkdir(dirname(hostPath), { recursive: true })
    await writeFile(hostPath, contents)
  } catch {
    // The structured result is best-effort; preserve the command failure if copying fails.
  }
}

function hostPathForVfsPath(vfsPath: string, mounts: MountSpec[]): string | undefined {
  for (const mount of mounts) {
    if (mount.mode !== "readwrite") {
      continue
    }

    const target = mount.target.replace(/\/+$/, "")
    if (vfsPath !== target && !vfsPath.startsWith(`${target}/`)) {
      continue
    }

    const relativePath = vfsPath === target ? "" : vfsPath.slice(target.length + 1)
    if (relativePath.split("/").includes("..")) {
      continue
    }

    return join(mount.source, relativePath)
  }

  return undefined
}
