import { loadPHPRuntime, PHP } from "@php-wasm/universal"
import { decodeRemoteZip, decodeZip } from "@php-wasm/stream-compression"
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
const MARKDOWN_DATABASE_INTEGRATION_REVISION = "af451895a9429895e3ad4d9b4e073bfd88873745"
const MARKDOWN_DATABASE_INTEGRATION_ARCHIVE_URL = `https://codeload.github.com/Automattic/markdown-database-integration/zip/${MARKDOWN_DATABASE_INTEGRATION_REVISION}`
const SITE_URL = "https://wp-codebox-runtime.invalid"
const DATABASE_PATH = "/wordpress/wp-content/database/.ht.sqlite"
const MARKDOWN_ROOT = "/wordpress/wp-content/markdown"
const MARKDOWN_INDEX_PATH = "/tmp/markdown-index.sqlite"
const R2_MARKDOWN_POINTER_KEY = "sites/default/markdown/current.json"
const R2_MARKDOWN_REVISION_PREFIX = "sites/default/markdown/revisions"
const R2_MARKDOWN_OBJECT_PREFIX = "sites/default/markdown/objects"
let bootPromise: Promise<{ php: PHP; wordpressVersion: string }> | undefined

interface Env {
  WORDPRESS_STATE: DurableObjectNamespace
  WORDPRESS_STATE_BUCKET: R2Bucket
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const phase = new URL(request.url).searchParams.get("phase")
    if (phase === "r2-state" || phase === "r2-mutate") {
      const expectedMethod = phase === "r2-mutate" ? "POST" : "GET"
      if (request.method !== expectedMethod) {
        return new Response(`WordPress state ${phase === "r2-mutate" ? "mutation" : "read"} requires ${expectedMethod}.`, { status: 405 })
      }
      const coordinator = env.WORDPRESS_STATE.getByName("default")
      return coordinator.fetch(request)
    }
    if (phase) return runBootProbe(phase)

    const runtime = await (bootPromise ??= bootWordPressRuntime(
      "do-not-attempt-installing",
      true,
      true,
      new Uint8Array(wordpressInstallSeed),
    ))
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

interface MarkdownPointer {
  revision: string
  manifestKey: string
  persistedAt: string
}

interface MarkdownManifestFile {
  path: string
  objectKey: string
  sha256: string
  size: number
}

interface MarkdownManifest extends MarkdownPointer {
  files: MarkdownManifestFile[]
}

interface RuntimeFile {
  path: string
  bytes: Uint8Array
}

export class WordPressStateCoordinator implements DurableObject {
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  fetch(request: Request): Promise<Response> {
    const response = this.tail
      .then(() => this.handleRequest(request))
      .catch((error: unknown) => Response.json({
        schema: "wp-codebox/cloudflare-wordpress-state-error/v1",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, { status: 500 }))
    this.tail = response.then(() => undefined, () => undefined)
    return response
  }

  private async handleRequest(request: Request): Promise<Response> {
    if (request.method === "GET") {
      const pointer = await this.readPointer()
      return Response.json({
        schema: "wp-codebox/cloudflare-wordpress-state/v1",
        durableObjectId: this.state.id.toString(),
        pointer,
      })
    }
    if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 })

    const pointer = await this.readPointer()
    const markdownFiles = pointer ? await this.readMarkdownRevision(pointer) : initialMarkdownFiles()
    const runtime = await bootMarkdownWordPressRuntime(markdownFiles)
    try {
      const mutationOutput = (await runtime.php.run({
        code: "<?php require '/wordpress/wp-load.php'; $current = (int) get_option('wp_codebox_mdi_revision', 0); $previous_found = 0 === $current || null !== get_page_by_path('cloudflare-r2-proof-' . $current, OBJECT, 'post'); $value = $current + 1; $post_id = wp_insert_post(['post_title' => 'Cloudflare R2 Proof ' . $value, 'post_name' => 'cloudflare-r2-proof-' . $value, 'post_content' => 'Persisted by MDI primary mode in R2 revision ' . $value . '.', 'post_status' => 'publish', 'post_type' => 'post'], true); if (is_wp_error($post_id)) { throw new Exception($post_id->get_error_message()); } update_option('wp_codebox_mdi_revision', $value); echo json_encode(['revisionValue' => $value, 'previousPostFound' => $previous_found, 'postId' => $post_id, 'wordpressVersion' => get_bloginfo('version')]);",
      })).text.trim()
      const mutation = JSON.parse(mutationOutput) as { revisionValue: number; previousPostFound: boolean; postId: number; wordpressVersion: string }
      const canonicalFiles = collectRuntimeFiles(runtime.php, MARKDOWN_ROOT)
      const nextPointer = await this.persistMarkdownRevision(canonicalFiles)
      return Response.json({
        schema: "wp-codebox/cloudflare-wordpress-mutation/v1",
        source: pointer ? "r2-markdown-revision" : "packaged-markdown-seed",
        ...mutation,
        canonicalFiles: canonicalFiles.length,
        sqlitePersisted: false,
        pointer: nextPointer,
      })
    } finally {
      runtime.php.exit()
    }
  }

  private async readPointer(): Promise<MarkdownPointer | null> {
    const object = await this.env.WORDPRESS_STATE_BUCKET.get(R2_MARKDOWN_POINTER_KEY)
    return object ? object.json<MarkdownPointer>() : null
  }

  private async readMarkdownRevision(pointer: MarkdownPointer): Promise<RuntimeFile[]> {
    const manifestObject = await this.env.WORDPRESS_STATE_BUCKET.get(pointer.manifestKey)
    if (!manifestObject) throw new Error(`R2 Markdown manifest is missing: ${pointer.manifestKey}`)
    const manifest = await manifestObject.json<MarkdownManifest>()
    const files: RuntimeFile[] = []
    for (const file of manifest.files) {
      const object = await this.env.WORDPRESS_STATE_BUCKET.get(file.objectKey)
      if (!object) throw new Error(`R2 Markdown object is missing: ${file.objectKey}`)
      files.push({ path: file.path, bytes: new Uint8Array(await object.arrayBuffer()) })
    }
    return files
  }

  private async persistMarkdownRevision(files: RuntimeFile[]): Promise<MarkdownPointer> {
    const manifestFiles: MarkdownManifestFile[] = []
    for (const file of files) {
      const sha256 = await sha256Hex(file.bytes)
      const objectKey = `${R2_MARKDOWN_OBJECT_PREFIX}/${sha256}`
      if (!await this.env.WORDPRESS_STATE_BUCKET.head(objectKey)) {
        await this.env.WORDPRESS_STATE_BUCKET.put(objectKey, file.bytes)
      }
      manifestFiles.push({ path: file.path, objectKey, sha256, size: file.bytes.byteLength })
    }

    const revision = crypto.randomUUID()
    const manifestKey = `${R2_MARKDOWN_REVISION_PREFIX}/${revision}.json`
    const persistedAt = new Date().toISOString()
    const pointer: MarkdownPointer = { revision, manifestKey, persistedAt }
    const manifest: MarkdownManifest = { ...pointer, files: manifestFiles }
    await this.env.WORDPRESS_STATE_BUCKET.put(manifestKey, JSON.stringify(manifest), {
      httpMetadata: { contentType: "application/json" },
    })
    await this.env.WORDPRESS_STATE_BUCKET.put(R2_MARKDOWN_POINTER_KEY, JSON.stringify(pointer), {
      httpMetadata: { contentType: "application/json" },
    })
    return pointer
  }
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

  if (phase === "mdi-files") {
    const php = new PHP(await createPhpRuntime())
    try {
      const wordpress = await materializeWordPressServerFiles(php)
      await materializeMarkdownDatabaseIntegration(php)
      materializeRuntimeFiles(php, MARKDOWN_ROOT, initialMarkdownFiles())
      const evidence = (await php.run({
        code: "<?php echo json_encode(['dropin' => file_exists('/wordpress/wp-content/db.php'), 'plugin' => file_exists('/wordpress/wp-content/plugins/markdown-database-integration/markdown-database-integration.php'), 'siteurl' => file_exists('/wordpress/wp-content/markdown/_options/siteurl.json')]);",
      })).text.trim()
      return probeResponse(phase, { ...wordpress, ...JSON.parse(evidence) as Record<string, string> })
    } finally {
      php.exit()
    }
  }

  if (phase === "mdi-shortinit") {
    const runtime = await bootMarkdownWordPressRuntime(initialMarkdownFiles())
    try {
      const evidence = (await runtime.php.run({
        code: "<?php define('SHORTINIT', true); require '/wordpress/wp-load.php'; echo json_encode(['wordpressVersion' => $wp_version, 'markdownDropin' => defined('MARKDOWN_DB_DROPIN'), 'markdownMode' => defined('MARKDOWN_DB_MODE') ? MARKDOWN_DB_MODE : '']);",
      })).text.trim()
      return probeResponse(phase, JSON.parse(evidence) as Record<string, string>)
    } finally {
      runtime.php.exit()
    }
  }

  if (phase === "mdi-index-artifact") {
    const runtime = await bootWordPressRuntime("do-not-attempt-installing", true, true, undefined, initialMarkdownFiles())
    try {
      await runtime.php.run({ code: "<?php define('SHORTINIT', true); require '/wordpress/wp-load.php';" })
      return new Response(Uint8Array.from(runtime.php.readFileAsBuffer(MARKDOWN_INDEX_PATH)).buffer, {
        headers: { "Content-Type": "application/vnd.sqlite3" },
      })
    } finally {
      runtime.php.exit()
    }
  }

  if (phase === "mdi-wordpress" || phase === "mdi-option" || phase === "mdi-insert") {
    const runtime = await bootMarkdownWordPressRuntime(initialMarkdownFiles())
    try {
      const operation = phase === "mdi-option"
        ? "$updated = update_option('wp_codebox_mdi_probe', 1); $result = ['updated' => $updated];"
        : phase === "mdi-insert"
          ? "$post_id = wp_insert_post(['post_title' => 'MDI Probe', 'post_name' => 'mdi-probe', 'post_content' => 'MDI probe body.', 'post_status' => 'publish', 'post_type' => 'post'], true); if (is_wp_error($post_id)) { throw new Exception($post_id->get_error_message()); } $result = ['postId' => $post_id];"
          : "$result = [];"
      const evidence = (await runtime.php.run({
        code: `<?php require '/wordpress/wp-load.php'; ${operation} echo json_encode(array_merge(['wordpressVersion' => get_bloginfo('version')], $result));`,
      })).text.trim()
      return probeResponse(phase, JSON.parse(evidence) as Record<string, string>)
    } finally {
      runtime.php.exit()
    }
  }

  if (["mdi-includes", "mdi-embed", "mdi-textdomain", "mdi-ai-client", "mdi-plugin-constants", "mdi-muplugins", "mdi-plugins", "mdi-theme", "mdi-site-health-class", "mdi-site-health", "mdi-current-user", "mdi-init", "mdi-wp-loaded"].includes(phase)) {
    const runtime = await bootWordPressRuntime("do-not-attempt-installing", true, true, undefined, initialMarkdownFiles())
    try {
      const evidence = (await runtime.php.run({ code: wordpressProbeCode(phase) })).text.trim()
      return probeResponse(phase, JSON.parse(evidence) as Record<string, string>)
    } finally {
      runtime.php.exit()
    }
  }

  if (phase?.startsWith("seeded-")) {
    const runtime = await bootWordPressRuntime(
      "do-not-attempt-installing",
      true,
      true,
      new Uint8Array(wordpressInstallSeed),
    )
    try {
      const wordpress = (await runtime.php.run({
        code: wordpressProbeCode(phase),
      })).text.trim()
      try {
        return probeResponse(phase, JSON.parse(wordpress) as Record<string, string>)
      } catch {
        return Response.json({
          schema: "wp-codebox/cloudflare-boot-probe/v1",
          phase,
          completed: false,
          evidence: { rawPhpOutput: wordpress },
        }, { status: 500 })
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

function wordpressProbeCode(phase: string): string {
  if (phase === "seeded-shortinit") {
    return "<?php define('SHORTINIT', true); require '/wordpress/wp-load.php'; echo json_encode(['wordpressVersion' => $wp_version, 'shortInit' => true]);"
  }
  if (phase === "seeded-wordpress") {
    return "<?php require '/wordpress/wp-load.php'; echo json_encode(['siteUrl' => get_option('siteurl'), 'wordpressVersion' => get_bloginfo('version')]);"
  }

  const stops: Record<string, { needle: string; after?: boolean }> = {
    "seeded-includes": { needle: "/**\n * @since 3.3.0" },
    "seeded-embed": { needle: "/**\n * WordPress Textdomain Registry object." },
    "seeded-textdomain": { needle: "// WordPress AI Client initialization." },
    "seeded-ai-client": { needle: "// Load multisite-specific files." },
    "seeded-plugin-constants": { needle: "// Load must-use plugins." },
    "seeded-muplugins": { needle: "if ( is_multisite() ) {\n\tms_cookie_constants();" },
    "seeded-plugins": { needle: "// Define constants which affect functionality if not already defined." },
    "seeded-theme": { needle: "// Create an instance of WP_Site_Health so that Cron events may fire." },
    "seeded-site-health-class": { needle: "WP_Site_Health::get_instance();" },
    "seeded-site-health": { needle: "// Set up current user." },
    "seeded-current-user": { needle: "/**\n * Fires after WordPress has finished loading but before any headers are sent." },
    "seeded-init": { needle: "// Check site status." },
    "seeded-wp-loaded": { needle: "do_action( 'wp_loaded' );", after: true },
  }
  const stop = stops[phase.replace(/^mdi-/, "seeded-")]
  if (!stop) throw new Error(`Unknown seeded WordPress probe phase: ${phase}`)

  return `<?php
$settings_path = '/wordpress/wp-settings.php';
$settings = file_get_contents($settings_path);
$needle = ${JSON.stringify(stop.needle)};
if (strpos($settings, $needle) === false) {
    throw new Exception('WordPress bootstrap probe needle not found.');
}
$stop = "echo json_encode(['wordpressVersion' => \\$wp_version, 'bootstrapPhase' => '${phase}']); return;\n";
$replacement = ${stop.after ? "$needle . \"\\n\" . $stop" : "$stop . $needle"};
file_put_contents($settings_path, str_replace($needle, $replacement, $settings));
require '/wordpress/wp-load.php';`
}

async function bootWordPressRuntime(
  wordpressInstallMode: WordPressInstallMode = "install-from-existing-files",
  includeSqlite = true,
  streamWordPressFiles = false,
  databaseSeed?: Uint8Array,
  markdownFiles?: RuntimeFile[],
  markdownIndexSeed?: Uint8Array,
): Promise<{ php: PHP; wordpressVersion: string }> {
  const requestHandler = await bootWordPressAndRequestHandler({
    createPhpRuntime,
    constants: {
      AUTOMATIC_UPDATER_DISABLED: true,
      DISABLE_WP_CRON: true,
      ...(markdownFiles ? {
        MARKDOWN_DB_CONTENT_DIR: MARKDOWN_ROOT,
        MARKDOWN_DB_INDEX_PATH: MARKDOWN_INDEX_PATH,
        MARKDOWN_DB_MODE: "primary",
        MARKDOWN_DB_STATE_DIR: MARKDOWN_ROOT,
      } : {}),
      WP_HTTP_BLOCK_EXTERNAL: true,
    },
    dataSqlPath: DATABASE_PATH,
    hooks: streamWordPressFiles || databaseSeed || markdownFiles ? {
      beforeWordPressFiles: streamWordPressFiles || markdownFiles ? async (php: PHP) => {
        if (streamWordPressFiles) await materializeWordPressServerFiles(php)
        if (markdownFiles) {
          await materializeMarkdownDatabaseIntegration(php)
          materializeRuntimeFiles(php, MARKDOWN_ROOT, markdownFiles)
          if (markdownIndexSeed) php.writeFile(MARKDOWN_INDEX_PATH, markdownIndexSeed)
        }
      } : undefined,
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

async function bootMarkdownWordPressRuntime(markdownFiles: RuntimeFile[]): Promise<{ php: PHP; wordpressVersion: string }> {
  const indexBuilder = await bootWordPressRuntime("do-not-attempt-installing", true, true, undefined, markdownFiles)
  let markdownIndex: Uint8Array
  try {
    await indexBuilder.php.run({
      code: "<?php define('SHORTINIT', true); require '/wordpress/wp-load.php';",
    })
    markdownIndex = Uint8Array.from(indexBuilder.php.readFileAsBuffer(MARKDOWN_INDEX_PATH))
  } finally {
    indexBuilder.php.exit()
  }
  return bootWordPressRuntime("do-not-attempt-installing", true, true, undefined, markdownFiles, markdownIndex)
}

function initialMarkdownFiles(): RuntimeFile[] {
  const options = [
    { option_id: 1, option_name: "siteurl", option_value: SITE_URL, autoload: "on" },
    { option_id: 2, option_name: "home", option_value: SITE_URL, autoload: "on" },
    { option_id: 3, option_name: "blogname", option_value: "WP Codebox Cloudflare Runtime", autoload: "on" },
  ]
  return options.map((option) => ({
    path: `_options/${option.option_name}.json`,
    bytes: new TextEncoder().encode(JSON.stringify(option, null, 2)),
  }))
}

function materializeRuntimeFiles(php: PHP, root: string, files: RuntimeFile[]): void {
  for (const file of files) {
    const destination = `${root}/${file.path}`
    php.mkdir(destination.slice(0, destination.lastIndexOf("/")))
    php.writeFile(destination, file.bytes)
  }
}

function collectRuntimeFiles(php: PHP, root: string): RuntimeFile[] {
  const files: RuntimeFile[] = []
  const visit = (directory: string): void => {
    for (const name of php.listFiles(directory)) {
      if (name === "." || name === "..") continue
      const path = `${directory}/${name}`
      if (php.isDir(path)) {
        visit(path)
      } else if (!name.includes(".tmp.") && !name.startsWith("markdown-index.sqlite")) {
        files.push({ path: path.slice(root.length + 1), bytes: php.readFileAsBuffer(path) })
      }
    }
  }
  visit(root)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function materializeMarkdownDatabaseIntegration(php: PHP): Promise<void> {
  const response = await fetch(MARKDOWN_DATABASE_INTEGRATION_ARCHIVE_URL)
  if (!response.ok || !response.body) throw new Error(`Unable to fetch Markdown Database Integration: ${response.status}.`)
  const stream = decodeZip(response.body)
  const reader = stream.getReader()
  while (true) {
    const { done, value: entry } = await reader.read()
    if (done) break
    const relative = archiveRelativePath(entry.name)
    if (relative !== "db.php"
      && relative !== "markdown-database-integration.php"
      && !(relative.startsWith("inc/") && relative.endsWith(".php"))) continue
    const bytes = new Uint8Array(await entry.arrayBuffer())
    const destination = `/wordpress/wp-content/plugins/markdown-database-integration/${relative}`
    php.mkdir(destination.slice(0, destination.lastIndexOf("/")))
    php.writeFile(destination, bytes)
    if (relative === "db.php") php.writeFile("/wordpress/wp-content/db.php", bytes)
  }
}

function archiveRelativePath(path: string): string {
  const separator = path.indexOf("/")
  return separator === -1 ? "" : path.slice(separator + 1)
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
