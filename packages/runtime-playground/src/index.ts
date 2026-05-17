import { mkdir, readdir, realpath, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import type {
  ArtifactBundle,
  ArtifactSpec,
  ExecutionResult,
  ExecutionSpec,
  MountSpec,
  ObservationResult,
  ObservationSpec,
  Runtime,
  RuntimeBackend,
  RuntimeCreateSpec,
  RuntimeInfo,
  Snapshot,
} from "@chubes4/sandbox-runtime-core"

function now(): string {
  return new Date().toISOString()
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export class PlaygroundRuntimeBackend implements RuntimeBackend {
  readonly kind = "wordpress-playground" as const

  async create(spec: RuntimeCreateSpec): Promise<Runtime> {
    return PlaygroundRuntime.create(spec)
  }
}

class PlaygroundRuntime implements Runtime {
  private status: RuntimeInfo["status"] = "created"
  private readonly runtimeId = id("runtime")
  private readonly createdAt = now()
  private readonly mounts: MountSpec[] = []
  private readonly commands: ExecutionResult[] = []
  private readonly observations: ObservationResult[] = []
  private readonly artifactRoot: string

  private constructor(private readonly spec: RuntimeCreateSpec) {
    this.artifactRoot = resolve(spec.artifactsDirectory ?? "artifacts", this.runtimeId)
  }

  static async create(spec: RuntimeCreateSpec): Promise<PlaygroundRuntime> {
    const runtime = new PlaygroundRuntime(spec)
    await mkdir(runtime.artifactRoot, { recursive: true })
    return runtime
  }

  async info(): Promise<RuntimeInfo> {
    return {
      id: this.runtimeId,
      backend: "wordpress-playground",
      environment: this.spec.environment,
      createdAt: this.createdAt,
      status: this.status,
    }
  }

  async mount(spec: MountSpec): Promise<void> {
    if (this.status === "destroyed") {
      throw new Error("Cannot mount into a destroyed runtime")
    }

    this.mounts.push({
      ...spec,
      source: await realpath(spec.source),
    })
  }

  async execute(spec: ExecutionSpec): Promise<ExecutionResult> {
    if (!this.spec.policy.commands.includes(spec.command)) {
      throw new Error(`Command is not allowed by runtime policy: ${spec.command}`)
    }

    const startedAt = now()
    const result: ExecutionResult = {
      id: id("command"),
      command: spec.command,
      args: spec.args ?? [],
      exitCode: 0,
      stdout: await this.executeStub(spec),
      stderr: "",
      startedAt,
      finishedAt: now(),
    }

    this.commands.push(result)
    return result
  }

  async observe(spec: ObservationSpec): Promise<ObservationResult> {
    const observation: ObservationResult = {
      type: spec.type,
      data: await this.observeStub(spec),
      observedAt: now(),
    }

    this.observations.push(observation)
    return observation
  }

  async snapshot(): Promise<Snapshot> {
    return {
      id: id("snapshot"),
      createdAt: now(),
      metadata: {
        runtime: await this.info(),
        mounts: this.mounts,
      },
    }
  }

  async collectArtifacts(_spec: ArtifactSpec = {}): Promise<ArtifactBundle> {
    await mkdir(this.artifactRoot, { recursive: true })

    const metadataPath = join(this.artifactRoot, "metadata.json")
    const commandsPath = join(this.artifactRoot, "commands.jsonl")
    const logsPath = join(this.artifactRoot, "logs.txt")
    const observationsPath = join(this.artifactRoot, "observations.json")

    await writeFile(
      metadataPath,
      `${JSON.stringify({ runtime: await this.info(), mounts: this.mounts, policy: this.spec.policy }, null, 2)}\n`,
    )
    await writeFile(commandsPath, this.commands.map((command) => JSON.stringify(command)).join("\n") + "\n")
    await writeFile(logsPath, this.commands.map((command) => command.stdout).join("\n---\n") + "\n")
    await writeFile(observationsPath, `${JSON.stringify(this.observations, null, 2)}\n`)

    return {
      id: id("artifact-bundle"),
      directory: this.artifactRoot,
      metadataPath,
      commandsPath,
      logsPath,
      observationsPath,
      createdAt: now(),
    }
  }

  async destroy(): Promise<void> {
    this.status = "destroyed"
  }

  private async executeStub(spec: ExecutionSpec): Promise<string> {
    if (spec.command === "inspect-mounted-inputs") {
      const inspected = []
      for (const mount of this.mounts) {
        const entries = mount.type === "directory" ? await readdir(mount.source) : [basename(mount.source)]
        inspected.push({ target: mount.target, source: mount.source, entries })
      }

      return JSON.stringify({ command: spec.command, mounts: inspected }, null, 2)
    }

    return JSON.stringify({ command: spec.command, args: spec.args ?? [], note: "stub execution" }, null, 2)
  }

  private async observeStub(spec: ObservationSpec): Promise<unknown> {
    if (spec.type === "runtime-info") {
      return this.info()
    }

    if (spec.type === "mounts") {
      return this.mounts
    }

    return { type: spec.type, path: spec.path ?? null }
  }
}

export function createPlaygroundRuntimeBackend(): RuntimeBackend {
  return new PlaygroundRuntimeBackend()
}
