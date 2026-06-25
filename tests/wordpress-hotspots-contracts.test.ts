import assert from "node:assert/strict"

import { WORDPRESS_HOTSPOTS_SCHEMA, performanceObservation, wordpressHotspotsArtifact } from "../packages/runtime-core/src/public.js"

const hotspots = wordpressHotspotsArtifact({
  generatedAt: "2026-01-01T00:00:00.000Z",
  source: "test-suite",
  observations: [
    performanceObservation({
      command: "wordpress.rest-performance-observation",
      target: "/wp/v2/posts",
      kind: "rest-request",
      timing: { durationMs: 120 },
      database: { queryCount: 3, totalTimeMs: 40 },
      artifactRefs: [{ path: "files/rest-posts.json", kind: "observation" }],
    }),
    {
      observation: performanceObservation({
        command: "wordpress.browser-page-load",
        target: "https://example.test/sample-page/",
        source: "browser",
        kind: "browser-page-load",
        timing: { durationMs: 60 },
        network: { failures: 2 },
        browser: { metrics: { layoutShift: 8 } },
      }),
      identifier: { block: "core/query" },
      artifactRefs: [{ path: "files/browser-sample.json", kind: "browser" }],
    },
  ],
})

assert.equal(hotspots.schema, WORDPRESS_HOTSPOTS_SCHEMA)
assert.equal(hotspots.summary.total, 2)
assert.deepEqual(hotspots.summary.surfaces, { browser: 1, rest: 1 })
assert.equal(hotspots.hotspots[0]?.identifier.surface, "browser")
assert.equal(hotspots.hotspots[0]?.identifier.id, "/sample-page/")
assert.equal(hotspots.hotspots[0]?.identifier.block, "core/query")
assert.equal(hotspots.hotspots[0]?.relativeScore, 1)
assert.equal(hotspots.hotspots[1]?.identifier.route, "/wp/v2/posts")
assert.deepEqual(hotspots.hotspots[1]?.artifactRefs?.map((ref) => ref.path), ["files/rest-posts.json"])

const fuzzHotspots = wordpressHotspotsArtifact({
  fuzzResult: {
    schema: "wp-codebox/fuzz-suite-result/v1",
    suite: { id: "runtime-suite" },
    status: "failed",
    success: false,
    summary: { total: 1, passed: 0, failed: 1, error: 0, skipped: 0 },
    cases: [{
      id: "rest-posts-fails",
      status: "failed",
      success: false,
      target: { kind: "rest", id: "/wp/v2/posts" },
      diagnostics: [{ severity: "error", code: "fuzz_suite_command_failed", message: "REST request failed" }],
      artifactRefs: [{ path: "files/fuzz-rest-posts.json", kind: "execution" }],
    }],
    diagnostics: [],
    artifactRefs: [],
  },
})

assert.equal(fuzzHotspots.hotspots.length, 1)
assert.equal(fuzzHotspots.hotspots[0]?.identifier.surface, "rest")
assert.equal(fuzzHotspots.hotspots[0]?.identifier.route, "/wp/v2/posts")
assert.equal(fuzzHotspots.hotspots[0]?.metrics[0]?.kind, "diagnostic-count")
assert.equal(fuzzHotspots.hotspots[0]?.score, 2000)
assert.deepEqual(fuzzHotspots.hotspots[0]?.diagnostics, ["fuzz_suite_command_failed"])

console.log("wordpress hotspots contracts ok")
