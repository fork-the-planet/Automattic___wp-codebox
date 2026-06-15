import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RuntimeCreateSpec } from "@automattic/wp-codebox-core"
import { runBrowserProbeCommand } from "../packages/runtime-playground/src/browser-command-runners.js"
import type { PlaygroundCliServer } from "../packages/runtime-playground/src/preview-server.js"

const workspace = await mkdtemp(join(tmpdir(), "wp-codebox-browser-probe-route-host-"))
let server: Server | undefined

try {
  let adminAjaxRequest: { host: string; forwardedHost: string; forwardedPort: string; forwardedProto: string } | undefined
  server = createServer((request, response) => {
    const host = request.headers.host ?? ""
    const forwardedHost = request.headers["x-forwarded-host"] ?? ""
    const forwardedPort = request.headers["x-forwarded-port"] ?? ""
    const forwardedProto = request.headers["x-forwarded-proto"] ?? ""
    if (request.url === "/wp-admin/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      response.end(`<!doctype html>
        <title>Dashboard</title>
        <div id="wpadminbar">Admin Bar</div>
        <script>
          fetch('/wp-admin/admin-ajax.php?action=rest-nonce')
            .then((response) => response.json())
            .then((payload) => console.log('rest nonce', payload.ok));
        </script>`)
      return
    }
    if (request.url === "/wp-admin/admin-ajax.php?action=rest-nonce") {
      adminAjaxRequest = {
        host,
        forwardedHost: Array.isArray(forwardedHost) ? forwardedHost.join(",") : forwardedHost,
        forwardedPort: Array.isArray(forwardedPort) ? forwardedPort.join(",") : forwardedPort,
        forwardedProto: Array.isArray(forwardedProto) ? forwardedProto.join(",") : forwardedProto,
      }
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ ok: true }))
      }, 250)
      return
    }
    if (request.url === "/redirect-to-https/") {
      response.writeHead(301, { location: `https://${host}/redirected/` })
      response.end("redirect")
      return
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    response.end(`<!doctype html><title>Probe</title><main data-path="${request.url ?? "/"}" data-host="${host}" data-forwarded-host="${forwardedHost}" data-forwarded-port="${forwardedPort}" data-forwarded-proto="${forwardedProto}">OK</main>`)
  })
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject)
    server?.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()
  assert.ok(address && typeof address === "object")

  const localUrl = `http://127.0.0.1:${address.port}/`
  const canonicalUrl = "https://example.test/canonical-route/"
  const runtimeSpec: RuntimeCreateSpec = { preview: { publicUrl: canonicalUrl } }
  const serverRef: PlaygroundCliServer = {
    playground: {
      async run() {
        return { text: "" }
      },
    },
    serverUrl: localUrl,
    async [Symbol.asyncDispose]() {},
  }

  const probe = await runBrowserProbeCommand({
    artifactRoot: workspace,
    runtimeSpec,
    server: serverRef,
    spec: {
      command: "wordpress.browser-probe",
      args: [
        `url=${canonicalUrl}`,
        "route-host=example.test",
        "wait-for=domcontentloaded",
        "capture=html,network",
      ],
    },
  })

  assert.equal(probe.artifact.requestedUrl, canonicalUrl)
  assert.equal(probe.artifact.summary.finalUrl, canonicalUrl)
  assert.equal(probe.artifact.summary.windowLocationOrigin, "https://example.test")

  const html = await readFile(join(workspace, "files", "browser", "snapshot.html"), "utf8")
  assert.match(html, /data-path="\/canonical-route\/"/)
  assert.match(html, /data-host="example\.test"/)
  assert.match(html, /data-forwarded-host="example\.test"/)
  assert.match(html, /data-forwarded-port="443"/)
  assert.match(html, /data-forwarded-proto="https"/)

  const redirectProbe = await runBrowserProbeCommand({
    artifactRoot: workspace,
    runtimeSpec,
    server: serverRef,
    spec: {
      command: "wordpress.browser-probe",
      args: [
        "url=http://example.test/redirect-to-https/",
        "route-host=example.test",
        "wait-for=domcontentloaded",
        "capture=html,network",
      ],
    },
  })

  assert.equal(redirectProbe.artifact.requestedUrl, "http://example.test/redirect-to-https/")
  assert.equal(redirectProbe.artifact.summary.finalUrl, "http://example.test/redirect-to-https/")

  const redirectedHtml = await readFile(join(workspace, "files", "browser", "snapshot.html"), "utf8")
  assert.match(redirectedHtml, /data-path="\/redirected\/"/)
  assert.match(redirectedHtml, /data-host="example\.test"/)
  assert.match(redirectedHtml, /data-forwarded-proto="https"/)

  const adminHost = "wpcom-codebox.wordpress.com"
  const adminProbe = await runBrowserProbeCommand({
    artifactRoot: join(workspace, "admin"),
    runtimeSpec,
    server: serverRef,
    spec: {
      command: "wordpress.browser-probe",
      args: [
        `url=http://${adminHost}/wp-admin/`,
        `route-host=${adminHost}`,
        "wait-for=selector:#wpadminbar",
        "capture=console,errors,network,html,screenshot,performance",
      ],
    },
  })

  assert.equal(adminProbe.artifact.requestedUrl, `http://${adminHost}/wp-admin/`)
  assert.equal(adminProbe.artifact.summary.finalUrl, `http://${adminHost}/wp-admin/`)
  assert.equal(adminProbe.artifact.summary.windowLocationOrigin, `http://${adminHost}`)
  assert.ok((adminProbe.artifact.networkPolicy?.hosts[adminHost]?.routed ?? 0) >= 2)
  assert.equal(adminAjaxRequest?.host, adminHost)
  assert.equal(adminAjaxRequest?.forwardedHost, adminHost)
  assert.equal(adminAjaxRequest?.forwardedPort, "80")
  assert.equal(adminAjaxRequest?.forwardedProto, "http")

  const adminNetworkLog = await readFile(join(workspace, "admin", "files", "browser", "network.jsonl"), "utf8")
  assert.match(adminNetworkLog, /wp-admin\/admin-ajax\.php\?action=rest-nonce/)

  console.log("Browser probe route-host smoke passed")
} finally {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
  await rm(workspace, { recursive: true, force: true })
}
