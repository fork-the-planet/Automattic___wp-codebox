import { loadPHPRuntime, PHP } from "@php-wasm/universal"
import { decodeRemoteZip } from "@php-wasm/stream-compression"
import { bootWordPressAndRequestHandler, type WordPressInstallMode } from "@wp-playground/wordpress"
// The PHP-WASM package publishes this Emscripten loader without TypeScript declarations.
// @ts-expect-error The adjacent Wasm declaration covers the compiled binary import.
import { dependenciesTotalSize, init } from "../../../node_modules/@php-wasm/web-8-5/asyncify/php_8_5.js"
import phpWasmModule from "../../../node_modules/@php-wasm/web-8-5/asyncify/8_5_8/php_8_5.wasm"
import { CLOUDFLARE_RUNTIME_HEALTH_MARKER, CLOUDFLARE_RUNTIME_HEALTH_SCHEMA, cloudflareRuntimeHealthResponse } from "./health-envelope.js"
import wordpressInstallSeed from "../assets/wordpress-install-seed.sqlite"

const PHP_VERSION = "8.5.8"
const WORDPRESS_ARCHIVE_URL = "https://wordpress.org/latest.zip"
const SQLITE_INTEGRATION_ARCHIVE_URL = "https://github.com/WordPress/sqlite-database-integration/releases/download/v2.2.23/plugin-sqlite-database-integration.zip"
const SITE_URL = "https://wp-codebox-runtime.invalid"
const DATABASE_PATH = "/wordpress/wp-content/database/.ht.sqlite"
let bootPromise: Promise<{ php: PHP; wordpressVersion: string }> | undefined

export default {
  async fetch(request: Request): Promise<Response> {
    const phase = new URL(request.url).searchParams.get("phase")
    if (phase) return runBootProbe(phase)

    const runtime = await (bootPromise ??= bootWordPressRuntime())
    const phpVersion = (await runtime.php.run({ code: "<?php echo PHP_VERSION;" })).text.trim()
    return cloudflareRuntimeHealthResponse({
      schema: CLOUDFLARE_RUNTIME_HEALTH_SCHEMA,
      marker: CLOUDFLARE_RUNTIME_HEALTH_MARKER,
      wordpressVersion: runtime.wordpressVersion,
      phpVersion,
      runtime: { backend: "wordpress-playground", environment: "wordpress" },
      evidence: { initialization: "completed", execution: "completed", initializationScope: "isolate" },
    })
  },
}

async function runBootProbe(phase: string): Promise<Response> {
  if (phase === "wordpress-archive" || phase === "sqlite-archive") {
    const archive = phase === "wordpress-archive"
      ? await fetchArchive(WORDPRESS_ARCHIVE_URL, "wordpress.zip")
      : await fetchArchive(SQLITE_INTEGRATION_ARCHIVE_URL, "sqlite-database-integration.zip")
    return probeResponse(phase, { archiveBytes: archive.size })
  }

  if (phase === "archives") {
    const wordpressZip = await fetchArchive(WORDPRESS_ARCHIVE_URL, "wordpress.zip")
    const sqliteZip = await fetchArchive(SQLITE_INTEGRATION_ARCHIVE_URL, "sqlite-database-integration.zip")
    return probeResponse(phase, { wordpressArchiveBytes: wordpressZip.size, sqliteArchiveBytes: sqliteZip.size })
  }

  if (phase === "php") {
    const php = new PHP(await createPhpRuntime())
    try {
      const phpVersion = (await php.run({ code: "<?php echo PHP_VERSION;" })).text.trim()
      return probeResponse(phase, { phpVersion })
    } finally {
      php.exit()
    }
  }

  if (phase === "php-wordpress-archive" || phase === "wordpress-archive-php") {
    const archive = phase === "wordpress-archive-php"
      ? await fetchArchive(WORDPRESS_ARCHIVE_URL, "wordpress.zip")
      : undefined
    const php = new PHP(await createPhpRuntime())
    try {
      const wordpressZip = archive ?? await fetchArchive(WORDPRESS_ARCHIVE_URL, "wordpress.zip")
      const phpVersion = (await php.run({ code: "<?php echo PHP_VERSION;" })).text.trim()
      return probeResponse(phase, { phpVersion, archiveBytes: wordpressZip.size })
    } finally {
      php.exit()
    }
  }

  if (phase === "streamed-files") {
    const php = new PHP(await createPhpRuntime())
    try {
      const evidence = await materializeWordPressServerFiles(php)
      const wordpressVersion = (await php.run({ code: "<?php require '/wordpress/wp-includes/version.php'; echo $wp_version;" })).text.trim()
      return probeResponse(phase, { ...evidence, wordpressVersion })
    } finally {
      php.exit()
    }
  }

  if (phase === "seeded-wordpress") {
    const runtime = await bootWordPressRuntime(
      "install-from-existing-files-if-needed",
      true,
      true,
      new Uint8Array(wordpressInstallSeed),
    )
    try {
      const wordpress = (await runtime.php.run({
        code: "<?php require '/wordpress/wp-load.php'; echo json_encode(['siteUrl' => get_option('siteurl'), 'wordpressVersion' => get_bloginfo('version')]);",
      })).text.trim()
      try {
        return probeResponse(phase, JSON.parse(wordpress) as Record<string, string>)
      } catch {
        throw new Error(`WordPress boot returned invalid JSON: ${wordpress}`)
      }
    } finally {
      runtime.php.exit()
    }
  }

  if (phase === "wordpress-files" || phase === "sqlite" || phase === "full" || phase === "streamed-sqlite" || phase === "streamed-wordpress") {
    const runtime = await bootWordPressRuntime(
      phase === "full" || phase === "streamed-wordpress" ? "install-from-existing-files" : "do-not-attempt-installing",
      phase !== "wordpress-files",
      phase === "streamed-sqlite" || phase === "streamed-wordpress",
    )
    try {
      const phpVersion = (await runtime.php.run({ code: "<?php echo PHP_VERSION;" })).text.trim()
      return probeResponse(phase, { phpVersion, wordpressVersion: runtime.wordpressVersion })
    } finally {
      if (phase !== "full") runtime.php.exit()
    }
  }

  return new Response(`Unknown boot probe phase: ${phase}`, { status: 400 })
}

async function bootWordPressRuntime(
  wordpressInstallMode: WordPressInstallMode = "install-from-existing-files",
  includeSqlite = true,
  streamWordPressFiles = false,
  databaseSeed?: Uint8Array,
): Promise<{ php: PHP; wordpressVersion: string }> {
  const requestHandler = await bootWordPressAndRequestHandler({
    createPhpRuntime,
    dataSqlPath: DATABASE_PATH,
    hooks: streamWordPressFiles || databaseSeed ? {
      beforeWordPressFiles: streamWordPressFiles ? materializeWordPressServerFiles : undefined,
      beforeDatabaseSetup: databaseSeed ? (php: PHP) => {
        php.mkdir("/wordpress/wp-content/database")
        php.writeFile(DATABASE_PATH, databaseSeed)
      } : undefined,
    } : undefined,
    maxPhpInstances: 1,
    phpVersion: "8.5",
    siteUrl: SITE_URL,
    wordPressZip: streamWordPressFiles ? undefined : fetchArchive(WORDPRESS_ARCHIVE_URL, "wordpress.zip"),
    sqliteIntegrationPluginZip: includeSqlite ? fetchArchive(SQLITE_INTEGRATION_ARCHIVE_URL, "sqlite-database-integration.zip") : undefined,
    wordpressInstallMode,
  })
  const php = await requestHandler.getPrimaryPhp()
  const wordpressVersion = (await php.run({ code: "<?php require '/wordpress/wp-includes/version.php'; echo $wp_version;" })).text.trim()
  if (!wordpressVersion) throw new Error("WordPress boot completed without a detected version.")
  return { php, wordpressVersion }
}

async function materializeWordPressServerFiles(php: PHP): Promise<{ materializedFiles: number; materializedBytes: number }> {
  const decoder = new TextDecoder()
  let materializedFiles = 0
  let materializedBytes = 0
  const stream = await decodeRemoteZip(WORDPRESS_ARCHIVE_URL, (entry: { path: Uint8Array }) => isWordPressServerFile(decoder.decode(entry.path)))
  const reader = stream.getReader()
  while (true) {
    const { done, value: entry } = await reader.read()
    if (done) break
    const path = entry instanceof File ? entry.name : decoder.decode(entry.path)
    if (!path.startsWith("wordpress/") || path.endsWith("/")) continue

    const destination = `/${path}`
    const bytes = entry instanceof File ? new Uint8Array(await entry.arrayBuffer()) : entry.bytes
    php.mkdir(destination.slice(0, destination.lastIndexOf("/")))
    php.writeFile(destination, bytes)
    materializedFiles++
    materializedBytes += bytes.byteLength
  }
  return { materializedFiles, materializedBytes }
}

function isWordPressServerFile(path: string): boolean {
  return /\.(?:php|json|crt|html)$/.test(path)
    || path.endsWith("/style.css")
    || path.endsWith("/wp-admin/css/view-transitions.min.css")
}

function createPhpRuntime() {
  return loadPHPRuntime(
    { dependencyFilename: "php_8_5.wasm", dependenciesTotalSize, phpWasmAsyncMode: "asyncify", init },
    { instantiateWasm: instantiatePrecompiledWasm(phpWasmModule) },
  )
}

async function fetchArchive(url: string, name: string): Promise<File> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Unable to fetch ${name}: ${response.status}.`)
  return new File([await response.arrayBuffer()], name, { type: "application/zip" })
}

function instantiatePrecompiledWasm(module: WebAssembly.Module) {
  return (imports: WebAssembly.Imports, receiveInstance: (instance: WebAssembly.Instance, wasmModule: WebAssembly.Module) => void) => receiveInstance(new WebAssembly.Instance(module, imports), module)
}

function probeResponse(phase: string, evidence: Record<string, number | string>): Response {
  return Response.json({ schema: "wp-codebox/cloudflare-boot-probe/v1", phase, completed: true, evidence })
}
