import { stripUndefined } from "./object-utils.js"
import type { FuzzSuiteArtifactRef, FuzzSuiteResultEnvelope } from "./fuzz-suite-contracts.js"
import type { PerformanceObservation, PerformanceObservationArtifactRef } from "./performance-observation.js"

export const WORDPRESS_HOTSPOTS_SCHEMA = "wp-codebox/wordpress-hotspots/v1" as const

export type WordPressHotspotSurface = "rest" | "page" | "admin" | "browser" | "db" | "block" | (string & {})

export type WordPressHotspotMetricKind = "duration-ms" | "query-count" | "query-time-ms" | "memory-delta-bytes" | "network-failures" | "browser-metric" | "diagnostic-count" | (string & {})

export interface WordPressHotspotIdentifier {
  surface: WordPressHotspotSurface
  id: string
  route?: string
  page?: string
  block?: string
  admin?: string
  db?: string
}

export interface WordPressHotspotMetric {
  kind: WordPressHotspotMetricKind
  value: number
  unit?: string
  source?: string
}

export interface WordPressHotspotArtifactRef {
  path: string
  kind?: string
  contentType?: string
  sha256?: string
  bytes?: number
  name?: string
  metadata?: Record<string, unknown>
}

export interface WordPressHotspotEntry {
  rank: number
  score: number
  relativeScore: number
  identifier: WordPressHotspotIdentifier
  metrics: WordPressHotspotMetric[]
  artifactRefs?: WordPressHotspotArtifactRef[]
  diagnostics?: string[]
  metadata?: Record<string, unknown>
}

export interface WordPressHotspotsArtifact {
  schema: typeof WORDPRESS_HOTSPOTS_SCHEMA
  generatedAt?: string
  source?: string
  hotspots: WordPressHotspotEntry[]
  summary: {
    total: number
    surfaces: Record<string, number>
    maxScore: number
  }
  artifactRefs?: WordPressHotspotArtifactRef[]
  metadata?: Record<string, unknown>
}

export interface WordPressHotspotObservationInput {
  observation: PerformanceObservation
  identifier?: Partial<WordPressHotspotIdentifier>
  artifactRefs?: WordPressHotspotArtifactRef[]
  metadata?: Record<string, unknown>
}

export interface WordPressHotspotsInput {
  observations?: readonly (PerformanceObservation | WordPressHotspotObservationInput)[]
  fuzzResult?: FuzzSuiteResultEnvelope
  generatedAt?: string
  source?: string
  artifactRefs?: readonly WordPressHotspotArtifactRef[]
  metadata?: Record<string, unknown>
}

interface PendingHotspot {
  identifier: WordPressHotspotIdentifier
  metrics: WordPressHotspotMetric[]
  artifactRefs: WordPressHotspotArtifactRef[]
  diagnostics: string[]
  metadata?: Record<string, unknown>
}

export function wordpressHotspotsArtifact(input: WordPressHotspotsInput = {}): WordPressHotspotsArtifact {
  const pending = [
    ...(input.observations ?? []).map(hotspotFromObservation),
    ...hotspotsFromFuzzResult(input.fuzzResult),
  ].filter((entry): entry is PendingHotspot => Boolean(entry))

  const scored = pending
    .map((entry) => ({ ...entry, score: hotspotScore(entry.metrics) }))
    .sort((a, b) => b.score - a.score || a.identifier.id.localeCompare(b.identifier.id))

  const maxScore = scored[0]?.score ?? 0
  const hotspots = scored.map((entry, index): WordPressHotspotEntry => stripUndefined({
    rank: index + 1,
    score: entry.score,
    relativeScore: maxScore > 0 ? Number((entry.score / maxScore).toFixed(6)) : 0,
    identifier: entry.identifier,
    metrics: entry.metrics,
    artifactRefs: dedupeHotspotArtifactRefs(entry.artifactRefs),
    diagnostics: entry.diagnostics.length ? entry.diagnostics : undefined,
    metadata: entry.metadata,
  }))

  return stripUndefined({
    schema: WORDPRESS_HOTSPOTS_SCHEMA,
    generatedAt: input.generatedAt,
    source: input.source,
    hotspots,
    summary: {
      total: hotspots.length,
      surfaces: hotspotSurfaceSummary(hotspots),
      maxScore,
    },
    artifactRefs: input.artifactRefs ? dedupeHotspotArtifactRefs(input.artifactRefs) : undefined,
    metadata: input.metadata,
  })
}

function hotspotFromObservation(input: PerformanceObservation | WordPressHotspotObservationInput): PendingHotspot | undefined {
  const wrapped = "observation" in input ? input : { observation: input }
  const observation = wrapped.observation
  const metrics = observationMetrics(observation)
  if (!metrics.length) return undefined

  const identifier = normalizeHotspotIdentifier({
    surface: observationSurface(observation),
    id: observation.target ?? observation.command ?? observation.kind ?? "wordpress-observation",
    ...wrapped.identifier,
  })

  return {
    identifier,
    metrics,
    artifactRefs: dedupeHotspotArtifactRefs([
      ...performanceArtifactRefs(observation.artifactRefs),
      ...(wrapped.artifactRefs ?? []),
    ]),
    diagnostics: observationDiagnostics(observation),
    metadata: stripUndefined({ command: observation.command, kind: observation.kind, source: observation.source, ...wrapped.metadata }),
  }
}

function hotspotsFromFuzzResult(result: FuzzSuiteResultEnvelope | undefined): PendingHotspot[] {
  if (!result) return []
  return result.cases.flatMap((fuzzCase) => {
    const diagnostics = fuzzCase.diagnostics.map((diagnostic) => diagnostic.code ?? diagnostic.message).filter(Boolean)
    const diagnosticCount = diagnostics.length + (fuzzCase.success ? 0 : 1)
    if (!diagnosticCount && !(fuzzCase.artifactRefs?.length)) return []
    const target = fuzzCase.target
    const identifier = normalizeHotspotIdentifier({
      surface: target?.kind === "rest" ? "rest" : target?.kind === "runtime-action" ? "browser" : target?.kind ?? "page",
      id: target?.id ?? target?.entrypoint ?? fuzzCase.id,
      route: target?.kind === "rest" ? target.id : undefined,
    })
    return [{
      identifier,
      metrics: diagnosticCount ? [{ kind: "diagnostic-count" as const, value: diagnosticCount, unit: "count", source: "fuzz-suite" }] : [],
      artifactRefs: fuzzArtifactRefs(fuzzCase.artifactRefs),
      diagnostics,
      metadata: stripUndefined({ caseId: fuzzCase.id, status: fuzzCase.status, target }),
    }]
  })
}

function observationMetrics(observation: PerformanceObservation): WordPressHotspotMetric[] {
  const metrics: WordPressHotspotMetric[] = []
  pushMetric(metrics, "duration-ms", observation.timing?.durationMs, "ms", "timing")
  pushMetric(metrics, "query-count", observation.database?.queryCount, "count", "database")
  pushMetric(metrics, "query-time-ms", observation.database?.totalTimeMs, "ms", "database")
  pushMetric(metrics, "memory-delta-bytes", observation.memory?.deltaBytes, "bytes", "memory")
  pushMetric(metrics, "network-failures", observation.network?.failures, "count", "network")
  for (const [name, value] of Object.entries(observation.browser?.metrics ?? {})) {
    pushMetric(metrics, "browser-metric", value, undefined, `browser.${name}`)
  }
  return metrics
}

function pushMetric(metrics: WordPressHotspotMetric[], kind: WordPressHotspotMetricKind, value: unknown, unit?: string, source?: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return
  metrics.push(stripUndefined({ kind, value, unit, source }))
}

function observationSurface(observation: PerformanceObservation): WordPressHotspotSurface {
  if (observation.kind === "rest-request" || observation.command === "wordpress.rest-performance-observation") return "rest"
  if (observation.kind === "browser-page-load" || observation.source === "browser") return "browser"
  if (observation.target?.startsWith("/wp-admin/") || observation.command?.includes("admin-page")) return "admin"
  if (observation.database?.queryCount || observation.database?.totalTimeMs) return "db"
  return "page"
}

function observationDiagnostics(observation: PerformanceObservation): string[] {
  return [observation.timing?.reason, observation.memory?.reason, observation.database?.reason, observation.hooks?.reason, observation.network?.reason, observation.browser?.reason].filter((entry): entry is string => Boolean(entry))
}

function hotspotScore(metrics: readonly WordPressHotspotMetric[]): number {
  return Number(metrics.reduce((score, metric) => score + metricWeight(metric), 0).toFixed(6))
}

function metricWeight(metric: WordPressHotspotMetric): number {
  if (metric.kind === "duration-ms") return metric.value
  if (metric.kind === "query-time-ms") return metric.value
  if (metric.kind === "query-count") return metric.value * 10
  if (metric.kind === "memory-delta-bytes") return metric.value / 1024 / 1024
  if (metric.kind === "network-failures") return metric.value * 100
  if (metric.kind === "diagnostic-count") return metric.value * 1000
  return metric.value
}

function normalizeHotspotIdentifier(input: Partial<WordPressHotspotIdentifier> & { id: string }): WordPressHotspotIdentifier {
  const surface = input.surface ?? "page"
  const id = stableHotspotId(input.id)
  return stripUndefined({
    surface,
    id,
    route: input.route ?? (surface === "rest" ? id : undefined),
    page: input.page ?? (surface === "page" || surface === "browser" ? id : undefined),
    block: input.block,
    admin: input.admin ?? (surface === "admin" ? id : undefined),
    db: input.db ?? (surface === "db" ? id : undefined),
  })
}

function stableHotspotId(value: string): string {
  return value.trim().replace(/^https?:\/\/[^/]+/i, "") || "wordpress-observation"
}

function performanceArtifactRefs(refs: readonly PerformanceObservationArtifactRef[] | undefined): WordPressHotspotArtifactRef[] {
  return (refs ?? []).flatMap((ref) => ref.path ? [stripUndefined({ path: ref.path, kind: ref.kind, metadata: stripUndefined({ id: ref.id, digest: ref.digest }) })] : [])
}

function fuzzArtifactRefs(refs: readonly FuzzSuiteArtifactRef[] | undefined): WordPressHotspotArtifactRef[] {
  return (refs ?? []).map((ref) => stripUndefined({ path: ref.path, kind: ref.kind, contentType: ref.contentType, sha256: ref.sha256, bytes: ref.bytes, name: ref.name, metadata: ref.metadata }))
}

function dedupeHotspotArtifactRefs(refs: readonly WordPressHotspotArtifactRef[]): WordPressHotspotArtifactRef[] {
  const seen = new Set<string>()
  const out: WordPressHotspotArtifactRef[] = []
  for (const ref of refs) {
    if (!ref.path || seen.has(ref.path)) continue
    seen.add(ref.path)
    out.push(ref)
  }
  return out
}

function hotspotSurfaceSummary(hotspots: readonly WordPressHotspotEntry[]): Record<string, number> {
  return hotspots.reduce<Record<string, number>>((summary, hotspot) => {
    summary[hotspot.identifier.surface] = (summary[hotspot.identifier.surface] ?? 0) + 1
    return summary
  }, {})
}
