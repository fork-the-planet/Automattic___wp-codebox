import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, relative, resolve } from "node:path"
import { promisify } from "node:util"
import { SANDBOX_WORKSPACE_ROOT, type MountSpec, type WorkspaceRecipe, type WorkspaceRecipeExtraPlugin, type WorkspaceRecipeStagedFile, type WorkspaceRecipeWorkspace } from "@chubes4/wp-codebox-core"

export interface PreparedWorkspaceMount {
  source: string
  target: string
  mode: "readonly" | "readwrite"
  cleanupPaths: string[]
  metadata: Record<string, unknown>
}

interface PreparedWorkspaceSource {
  source: string
  baselineSource: string
  cleanupPaths: string[]
}

export type RecipeSourceType = "local" | "https_zip" | "wporg_plugin_zip"

export interface RecipeSourceProvenance {
  kind: RecipeSourceType
  original: string
  resolvedUrl?: string
  digest?: {
    sha256: string
    expected?: string
    verified?: boolean
  }
  policy?: {
    host: string
    maxDownloadBytes: number
    maxExtractedBytes: number
    maxExtractedFiles: number
    sha256Required: boolean
  }
  localPathCategory?: "recipe-relative" | "temporary-download"
}

interface PreparedExternalSource {
  source: string
  cleanupPaths: string[]
  provenance: RecipeSourceProvenance
}

export interface PreparedExtraPlugin {
  source: string
  slug: string
  target: string
  pluginFile: string
  activate: boolean
  loadAs: "plugin" | "mu-plugin"
  cleanupPaths: string[]
  provenance: RecipeSourceProvenance
}

export interface RecipeStagedFileProvenance {
  kind: "local"
  original: string
  localPathCategory?: "recipe-relative"
}

export interface PreparedStagedFile {
  source: string
  originalSource: string
  sourceRef: string
  target: string
  type: MountSpec["type"]
  cleanupPaths: string[]
  provenance: RecipeStagedFileProvenance
  metadata: Record<string, unknown>
}

export interface ParsedRecipeSource {
  type: RecipeSourceType
  resolvedUrl: string
  host: string
  expectedSha256?: string
  wporgSlug?: string
}

export const ALLOW_NETWORK_DOWNLOADS_ENV = "WP_CODEBOX_ALLOW_NETWORK_DOWNLOADS"
export const ALLOWED_DOWNLOAD_HOSTS_ENV = "WP_CODEBOX_ALLOWED_DOWNLOAD_HOSTS"
export const REQUIRE_SOURCE_SHA256_ENV = "WP_CODEBOX_REQUIRE_SOURCE_SHA256"
export const MAX_DOWNLOAD_BYTES_ENV = "WP_CODEBOX_MAX_DOWNLOAD_BYTES"
export const MAX_EXTRACTED_BYTES_ENV = "WP_CODEBOX_MAX_EXTRACTED_BYTES"
export const MAX_EXTRACTED_FILES_ENV = "WP_CODEBOX_MAX_EXTRACTED_FILES"

const DEFAULT_ALLOWED_DOWNLOAD_HOSTS = ["downloads.wordpress.org"]
const DEFAULT_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
const DEFAULT_MAX_EXTRACTED_BYTES = 100 * 1024 * 1024
const DEFAULT_MAX_EXTRACTED_FILES = 2000
const execFileAsync = promisify(execFile)

export function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value)
}

export function sourceSha256Required(): boolean {
  return process.env[REQUIRE_SOURCE_SHA256_ENV] === "1"
}

export function allowedDownloadHosts(): string[] {
  const configured = process.env[ALLOWED_DOWNLOAD_HOSTS_ENV]
  return (configured ? configured.split(",") : DEFAULT_ALLOWED_DOWNLOAD_HOSTS)
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

function envPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? "")
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

export function maxDownloadBytes(): number {
  return envPositiveInteger(MAX_DOWNLOAD_BYTES_ENV, DEFAULT_MAX_DOWNLOAD_BYTES)
}

export function maxExtractedBytes(): number {
  return envPositiveInteger(MAX_EXTRACTED_BYTES_ENV, DEFAULT_MAX_EXTRACTED_BYTES)
}

export function maxExtractedFiles(): number {
  return envPositiveInteger(MAX_EXTRACTED_FILES_ENV, DEFAULT_MAX_EXTRACTED_FILES)
}

function normalizedWorkspaceSeedExcludePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "")
}

function workspaceSeedExcludeMatches(relativePath: string, excludePath: string): boolean {
  const normalizedRelativePath = normalizedWorkspaceSeedExcludePath(relativePath)
  const normalizedExcludePath = normalizedWorkspaceSeedExcludePath(excludePath)
  if (!normalizedExcludePath) {
    return false
  }

  if (normalizedExcludePath.endsWith("*")) {
    return normalizedRelativePath.startsWith(normalizedExcludePath.slice(0, -1))
  }

  return normalizedRelativePath === normalizedExcludePath || normalizedRelativePath.startsWith(`${normalizedExcludePath}/`)
}

function shouldCopyWorkspaceSeedEntry(sourceRoot: string, entry: string, excludePaths: string[] = []): boolean {
  const relativePath = relative(sourceRoot, entry)
  if (!relativePath) {
    return true
  }

  return !excludePaths.some((excludePath) => workspaceSeedExcludeMatches(relativePath, excludePath))
}

async function copyWorkspaceSeedDirectory(source: string, target: string, excludePaths: string[] = []): Promise<void> {
  await cp(source, target, {
    recursive: true,
    filter: (entry) => shouldCopyWorkspaceSeedEntry(source, entry, excludePaths),
  })
}

export async function prepareRecipeWorkspaces(recipe: WorkspaceRecipe, recipeDirectory: string): Promise<PreparedWorkspaceMount[]> {
  const workspaces = recipe.inputs?.workspaces ?? []
  const mounts: PreparedWorkspaceMount[] = []
  for (const [index, workspace] of workspaces.entries()) {
    const slug = workspace.seed.slug ?? basename(resolve(recipeDirectory, workspace.seed.source ?? `workspace-${index}`))
    const prepared = await prepareRecipeWorkspace(workspace, recipeDirectory, slug)
    const target = workspace.target ?? defaultWorkspaceTarget(workspace, slug)
    mounts.push({
      source: prepared.source,
      target,
      mode: workspace.mode ?? "readwrite",
      cleanupPaths: prepared.cleanupPaths,
      metadata: {
        kind: "recipe-workspace",
        index,
        seed: workspace.seed,
        baselineSource: prepared.baselineSource,
        target,
        workspaceRoot: SANDBOX_WORKSPACE_ROOT,
        sourceMode: workspace.sourceMode ?? "repo-backed",
      },
    })
  }

  return mounts
}

async function cleanupRecipeWorkspaces(workspaces: PreparedWorkspaceMount[]): Promise<void> {
  await Promise.all(workspaces.flatMap((workspace) => workspace.cleanupPaths).map((path) => rm(path, { recursive: true, force: true })))
}

export async function cleanupRecipePreparedSources(workspaces: PreparedWorkspaceMount[], extraPlugins: PreparedExtraPlugin[], stagedFiles: PreparedStagedFile[] = []): Promise<void> {
  await Promise.all([
    cleanupRecipeWorkspaces(workspaces),
    ...extraPlugins.flatMap((plugin) => plugin.cleanupPaths).map((path) => rm(path, { recursive: true, force: true })),
    ...stagedFiles.flatMap((stagedFile) => stagedFile.cleanupPaths).map((path) => rm(path, { recursive: true, force: true })),
  ])
}

export async function prepareRecipeExtraPlugins(recipe: WorkspaceRecipe, recipeDirectory: string): Promise<PreparedExtraPlugin[]> {
  const plugins: PreparedExtraPlugin[] = []
  for (const plugin of recipeExtraPlugins(recipe)) {
    const slug = recipeExtraPluginSlug(plugin)
    const resolved = await prepareRecipeSource(plugin.source, recipeDirectory, slug, plugin.sha256)
    const pluginFile = await resolveRecipeExtraPluginFile(plugin, recipeDirectory)
    const loadAs = plugin.loadAs ?? "plugin"
    await assertPreparedPluginFileExists(resolved.source, pluginFile.slice(slug.length + 1), plugin.source)
    plugins.push({
      source: resolved.source,
      slug,
      target: pluginTarget(slug, loadAs),
      pluginFile,
      activate: plugin.activate !== false,
      loadAs,
      cleanupPaths: resolved.cleanupPaths,
      provenance: resolved.provenance,
    })
  }

  return plugins
}

export async function prepareRecipeStagedFiles(recipe: WorkspaceRecipe, recipeDirectory: string): Promise<PreparedStagedFile[]> {
  const stagedFiles: PreparedStagedFile[] = []
  for (const [index, stagedFile] of (recipe.inputs?.stagedFiles ?? []).entries()) {
    const originalSource = resolve(recipeDirectory, stagedFile.source)
    const type = await stagedFileMountType(originalSource)
    const stagingRoot = await mkdtemp(join(tmpdir(), "wp-codebox-staged-file-"))
    const stagedSource = join(stagingRoot, basename(originalSource))
    await cp(originalSource, stagedSource, { recursive: type === "directory" })
    const provenance = stagedFileProvenance(stagedFile, recipeDirectory)
    stagedFiles.push({
      source: stagedSource,
      originalSource,
      sourceRef: stagedFile.source,
      target: stagedFile.target,
      type,
      cleanupPaths: [stagingRoot],
      provenance,
      metadata: {
        kind: "staged-file",
        index,
        source: provenance,
      },
    })
  }

  return stagedFiles
}

export async function stagedFileMountType(source: string): Promise<MountSpec["type"]> {
  return recipeMountType(source)
}

export async function recipeMountType(source: string, explicitType?: MountSpec["type"]): Promise<MountSpec["type"]> {
  if (explicitType === "directory" || explicitType === "file") {
    return explicitType
  }

  const result = await stat(source)
  if (result.isDirectory()) {
    return "directory"
  }
  if (result.isFile()) {
    return "file"
  }

  throw new Error(`Recipe mount source must be a file or directory: ${source}`)
}

export function stagedFileProvenance(stagedFile: WorkspaceRecipeStagedFile, recipeDirectory: string): RecipeStagedFileProvenance {
  return {
    kind: "local",
    original: stagedFile.source,
    localPathCategory: resolve(recipeDirectory, stagedFile.source).startsWith(recipeDirectory) ? "recipe-relative" : undefined,
  }
}

async function assertPreparedPluginFileExists(sourceDirectory: string, pluginFileRelativeToSource: string, sourceRef: string): Promise<void> {
  try {
    const result = await stat(join(sourceDirectory, pluginFileRelativeToSource))
    if (result.isFile()) {
      return
    }
  } catch {
    // Throw a stable message below.
  }

  throw new Error(`Recipe extra plugin source did not contain expected plugin file ${pluginFileRelativeToSource}: ${sourceRef}`)
}

async function prepareRecipeSource(sourceRef: string, recipeDirectory: string, slug: string, expectedSha256?: string): Promise<PreparedExternalSource> {
  const source = recipeSource(sourceRef, expectedSha256)
  if (source.type === "local") {
    return {
      source: resolve(recipeDirectory, sourceRef),
      cleanupPaths: [],
      provenance: recipeSourceProvenance(source, recipeDirectory),
    }
  }

  if (process.env[ALLOW_NETWORK_DOWNLOADS_ENV] !== "1") {
    throw new Error(`External recipe sources require ${ALLOW_NETWORK_DOWNLOADS_ENV}=1 before WP Codebox downloads anything.`)
  }

  if (!allowedDownloadHosts().includes(source.host)) {
    throw new Error(`External recipe source host is not allowed: ${source.host}`)
  }

  const directory = await mkdtemp(join(tmpdir(), `wp-codebox-source-${slug}-`))
  const zipPath = join(directory, "source.zip")
  const extractDirectory = join(directory, "extracted")
  await mkdir(extractDirectory, { recursive: true })
  const digest = await downloadRecipeSourceZip(source.resolvedUrl, zipPath, source.expectedSha256)
  await assertSafeZipEntries(zipPath)
  await execFileAsync("unzip", ["-q", zipPath, "-d", extractDirectory])
  await assertExtractedSourceBounds(extractDirectory)

  return {
    source: await extractedPluginSourceDirectory(extractDirectory, slug),
    cleanupPaths: [directory],
    provenance: {
      ...recipeSourceProvenance(source, recipeDirectory),
      digest: { sha256: digest, ...(source.expectedSha256 ? { expected: source.expectedSha256, verified: true } : {}) },
      policy: {
        host: source.host,
        maxDownloadBytes: maxDownloadBytes(),
        maxExtractedBytes: maxExtractedBytes(),
        maxExtractedFiles: maxExtractedFiles(),
        sha256Required: sourceSha256Required(),
      },
      localPathCategory: "temporary-download",
    },
  }
}

async function downloadRecipeSourceZip(url: string, targetPath: string, expectedSha256?: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download recipe source ${url}: HTTP ${response.status}`)
  }

  const finalUrl = response.url || url
  let finalSource: ParsedRecipeSource
  try {
    finalSource = recipeSource(finalUrl, expectedSha256)
  } catch (error) {
    throw new Error(`Recipe source redirected to an invalid URL: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (finalSource.type === "local" || !allowedDownloadHosts().includes(finalSource.host)) {
    throw new Error(`Recipe source redirected to a host that is not allowed: ${finalSource.host || finalUrl}`)
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0")
  if (contentLength > maxDownloadBytes()) {
    throw new Error(`Recipe source download exceeds ${maxDownloadBytes()} bytes: ${url}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > maxDownloadBytes()) {
    throw new Error(`Recipe source download exceeds ${maxDownloadBytes()} bytes: ${url}`)
  }

  const digest = createHash("sha256").update(buffer).digest("hex")
  if (expectedSha256 && digest !== expectedSha256.toLowerCase()) {
    throw new Error(`Recipe source sha256 mismatch for ${url}: expected ${expectedSha256.toLowerCase()}, got ${digest}`)
  }

  await writeFile(targetPath, buffer)
  return digest
}

async function assertSafeZipEntries(zipPath: string): Promise<void> {
  const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath])
  const entries = stdout.split(/\r?\n/).filter(Boolean)
  if (entries.length > maxExtractedFiles()) {
    throw new Error(`Recipe source zip contains too many entries: ${entries.length}`)
  }

  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/")
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error(`Recipe source zip contains an unsafe path: ${entry}`)
    }
  }
}

async function assertExtractedSourceBounds(directory: string): Promise<void> {
  const totals = await directoryTotals(directory)
  if (totals.files > maxExtractedFiles()) {
    throw new Error(`Recipe source extraction contains too many files: ${totals.files}`)
  }
  if (totals.bytes > maxExtractedBytes()) {
    throw new Error(`Recipe source extraction exceeds ${maxExtractedBytes()} bytes: ${totals.bytes}`)
  }
}

async function directoryTotals(directory: string): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const child = await directoryTotals(path)
      files += child.files
      bytes += child.bytes
    } else if (entry.isFile()) {
      const result = await stat(path)
      files += 1
      bytes += result.size
    }
  }
  return { files, bytes }
}

async function extractedPluginSourceDirectory(extractDirectory: string, slug: string): Promise<string> {
  const slugDirectory = join(extractDirectory, slug)
  try {
    const result = await stat(slugDirectory)
    if (result.isDirectory()) {
      return slugDirectory
    }
  } catch {
    // Fall through to generic zip layout.
  }

  return extractDirectory
}

async function prepareRecipeWorkspace(workspace: WorkspaceRecipeWorkspace, recipeDirectory: string, slug: string): Promise<PreparedWorkspaceSource> {
  const directory = await mkdtemp(join(tmpdir(), `wp-codebox-${slug}-`))
  const baselineDirectory = await mkdtemp(join(tmpdir(), `wp-codebox-${slug}-baseline-`))
  if (workspace.seed.type === "directory") {
    const source = resolve(recipeDirectory, workspace.seed.source ?? "")
    await copyWorkspaceSeedDirectory(source, directory, workspace.seed.excludePaths)
    await copyWorkspaceSeedDirectory(source, baselineDirectory, workspace.seed.excludePaths)
    await ensureStandaloneGitPrimary(directory)
    return { source: directory, baselineSource: baselineDirectory, cleanupPaths: [directory, baselineDirectory] }
  }

  if (workspace.seed.type === "theme_scaffold") {
    await writeThemeScaffold(directory, slug, workspace.seed.name ?? titleFromSlug(slug))
    await writeThemeScaffold(baselineDirectory, slug, workspace.seed.name ?? titleFromSlug(slug))
    return { source: directory, baselineSource: baselineDirectory, cleanupPaths: [directory, baselineDirectory] }
  }

  await writePluginScaffold(directory, slug, workspace.seed.name ?? titleFromSlug(slug))
  await writePluginScaffold(baselineDirectory, slug, workspace.seed.name ?? titleFromSlug(slug))
  return { source: directory, baselineSource: baselineDirectory, cleanupPaths: [directory, baselineDirectory] }
}

async function ensureStandaloneGitPrimary(directory: string): Promise<void> {
  const gitPath = join(directory, ".git")
  try {
    const gitStat = await stat(gitPath)
    if (gitStat.isDirectory()) {
      return
    }

    await rm(gitPath, { force: true })
  } catch {
    // No Git metadata was copied; initialize a sandbox-local primary below.
  }

  await execFileAsync("git", ["init", "--quiet"], { cwd: directory })
}

export function defaultWorkspaceTarget(workspace: WorkspaceRecipeWorkspace, slug: string): string {
  if (workspace.seed.type === "theme_scaffold") {
    return `/wordpress/wp-content/themes/${slug}`
  }

  if (workspace.seed.type === "plugin_scaffold") {
    return `/wordpress/wp-content/plugins/${slug}`
  }

  if (workspace.target) {
    return workspace.target
  }

  return `${SANDBOX_WORKSPACE_ROOT}/${slug}`
}

async function writePluginScaffold(directory: string, slug: string, name: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, `${slug}.php`), `<?php
/**
 * Plugin Name: ${name}
 * Description: WP Codebox seeded plugin workspace.
 * Version: 0.1.0
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', static function (): void {
	do_action( '${slug.replace(/-/g, "_")}_loaded' );
} );
`)
  await writeFile(join(directory, "README.md"), `# ${name}

Seeded by WP Codebox.
`)
}

async function writeThemeScaffold(directory: string, slug: string, name: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, "style.css"), `/*
Theme Name: ${name}
Description: WP Codebox seeded theme workspace.
Version: 0.1.0
*/
`)
  await writeFile(join(directory, "index.php"), `<?php
?><main id="site-content"><h1><?php bloginfo( 'name' ); ?></h1></main>
`)
  await writeFile(join(directory, "README.md"), `# ${name}

Seeded by WP Codebox.
`)
}

function titleFromSlug(slug: string): string {
  return slug.split(/[-_]+/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ")
}

export function recipeExtraPlugins(recipe: WorkspaceRecipe): WorkspaceRecipeExtraPlugin[] {
  return recipe.inputs?.extra_plugins ?? recipe.inputs?.extraPlugins ?? []
}

export function recipeSource(sourceRef: string, expectedSha256?: string): ParsedRecipeSource {
  let url: URL
  try {
    url = new URL(sourceRef)
  } catch {
    return { type: "local", resolvedUrl: sourceRef, host: "" }
  }

  if (url.protocol !== "https:") {
    throw new Error(`External recipe sources must use https:// URLs: ${sourceRef}`)
  }

  if (!url.pathname.toLowerCase().endsWith(".zip")) {
    throw new Error(`External recipe sources must point to .zip archives: ${sourceRef}`)
  }

  if (url.hostname === "downloads.wordpress.org" && url.pathname.startsWith("/plugin/")) {
    const filename = basename(url.pathname)
    const match = filename.match(/^([A-Za-z0-9_-]+)\./)
    return { type: "wporg_plugin_zip", resolvedUrl: url.toString(), host: url.hostname, ...(expectedSha256 ? { expectedSha256: expectedSha256.toLowerCase() } : {}), ...(match ? { wporgSlug: match[1] } : {}) }
  }

  return { type: "https_zip", resolvedUrl: url.toString(), host: url.hostname, ...(expectedSha256 ? { expectedSha256: expectedSha256.toLowerCase() } : {}) }
}

export function recipeSourceProvenance(source: ParsedRecipeSource, recipeDirectory: string): RecipeSourceProvenance {
  if (source.type === "local") {
    return {
      kind: "local",
      original: source.resolvedUrl,
      localPathCategory: resolve(recipeDirectory, source.resolvedUrl).startsWith(recipeDirectory) ? "recipe-relative" : undefined,
    }
  }

  return {
    kind: source.type,
    original: source.resolvedUrl,
    resolvedUrl: source.resolvedUrl,
    ...(source.expectedSha256 ? { digest: { sha256: source.expectedSha256, expected: source.expectedSha256, verified: false } } : {}),
    policy: {
      host: source.host,
      maxDownloadBytes: maxDownloadBytes(),
      maxExtractedBytes: maxExtractedBytes(),
      maxExtractedFiles: maxExtractedFiles(),
      sha256Required: sourceSha256Required(),
    },
  }
}

export function recipeExtraPluginSlug(plugin: WorkspaceRecipeExtraPlugin): string {
  if (plugin.slug) {
    return plugin.slug
  }

  const source = recipeSource(plugin.source, plugin.sha256)
  if (source.wporgSlug) {
    return source.wporgSlug
  }

  if (source.type !== "local") {
    throw new Error(`External extra_plugins sources require slug when it cannot be inferred from a WordPress.org plugin URL: ${plugin.source}`)
  }

  return basename(resolve(plugin.source))
}

export function recipeExtraPluginFile(plugin: WorkspaceRecipeExtraPlugin): string {
  const slug = recipeExtraPluginSlug(plugin)
  return plugin.pluginFile ?? `${slug}/${slug}.php`
}

export function pluginTarget(slug: string, loadAs: PreparedExtraPlugin["loadAs"]): string {
  if (loadAs === "mu-plugin") {
    return `/wordpress/wp-content/mu-plugins/wp-codebox-runtime/${slug}`
  }

  return `/wordpress/wp-content/plugins/${slug}`
}

export async function resolveRecipeExtraPluginFile(plugin: WorkspaceRecipeExtraPlugin, recipeDirectory: string): Promise<string> {
  const slug = recipeExtraPluginSlug(plugin)
  if (plugin.pluginFile) {
    return plugin.pluginFile
  }

  const source = recipeSource(plugin.source, plugin.sha256)
  if (source.type === "local") {
    const pluginSource = resolve(recipeDirectory, plugin.source)
    for (const candidate of [`${slug}/${slug}.php`, `${slug}/plugin.php`]) {
      try {
        const result = await stat(join(pluginSource, candidate.slice(slug.length + 1)))
        if (result.isFile()) {
          return candidate
        }
      } catch {
        // Try the next common plugin entrypoint.
      }
    }
  }

  return `${slug}/${slug}.php`
}

export function activateExtraPluginsCode(extraPlugins: PreparedExtraPlugin[]): string | null {
  const pluginFiles = extraPlugins
    .filter((plugin) => plugin.loadAs === "plugin" && plugin.activate !== false)
    .map((plugin) => plugin.pluginFile)

  if (pluginFiles.length === 0) {
    return null
  }

  return `require_once ABSPATH . 'wp-admin/includes/plugin.php';
$plugins = ${JSON.stringify(pluginFiles)};
$activated = array();
foreach ($plugins as $plugin) {
    $plugin_file = WP_PLUGIN_DIR . '/' . $plugin;
    if (! file_exists($plugin_file)) {
        throw new RuntimeException(sprintf('Recipe extra plugin is not mounted: %s', $plugin));
    }
    if (! is_plugin_active($plugin)) {
        $result = activate_plugin($plugin);
        if (is_wp_error($result)) {
            throw new RuntimeException($result->get_error_message());
        }
    }
    $activated[] = $plugin;
}
echo wp_json_encode(array('command' => 'activate-extra-plugins', 'plugins' => $activated), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);`
}

export function installMuPluginsCode(extraPlugins: PreparedExtraPlugin[]): string | null {
  const muPlugins = extraPlugins
    .filter((plugin) => plugin.loadAs === "mu-plugin")
    .map((plugin) => plugin.pluginFile)

  if (muPlugins.length === 0) {
    return null
  }

  return `$plugins = ${JSON.stringify(muPlugins)};
$runtime_dir = WPMU_PLUGIN_DIR . '/wp-codebox-runtime';
if (!is_dir(WPMU_PLUGIN_DIR) && !mkdir(WPMU_PLUGIN_DIR, 0777, true) && !is_dir(WPMU_PLUGIN_DIR)) {
    throw new RuntimeException('Could not create mu-plugins directory.');
}
if (!is_dir($runtime_dir)) {
    throw new RuntimeException('WP Codebox runtime mu-plugin directory is not mounted.');
}
$loader = WPMU_PLUGIN_DIR . '/wp-codebox-runtime-loader.php';
$lines = array(
    '<?php',
    '/**',
    ' * Plugin Name: WP Codebox Runtime Loader',
    ' * Description: Loads WP Codebox runtime substrate as must-use plugins.',
    ' */',
    '',
    "defined( 'ABSPATH' ) || exit;",
    '',
    "if ( ! defined( 'DATAMACHINE_WORKSPACE_PATH' ) ) {",
    "    define( 'DATAMACHINE_WORKSPACE_PATH', ${JSON.stringify(SANDBOX_WORKSPACE_ROOT)} );",
    "}",
    "add_filter( 'datamachine_should_load_full_runtime', '__return_true', 1 );",
    '',
);
foreach ($plugins as $plugin) {
    if ('' === $plugin || str_starts_with($plugin, '/') || str_contains($plugin, '..') || !str_ends_with($plugin, '.php')) {
        throw new RuntimeException('Unsafe WP Codebox runtime mu-plugin entry.');
    }
    $plugin_file = $runtime_dir . '/' . $plugin;
    if (!file_exists($plugin_file)) {
        throw new RuntimeException(sprintf('WP Codebox runtime mu-plugin is not mounted: %s', $plugin));
    }
    $lines[] = "require_once WPMU_PLUGIN_DIR . '/wp-codebox-runtime/" . str_replace("'", "\\'", $plugin) . "';";
}
if (false === file_put_contents($loader, implode("\\n", $lines) . "\\n")) {
    throw new RuntimeException('Could not write WP Codebox runtime mu-plugin loader.');
}
echo wp_json_encode(array('command' => 'install-mu-plugins', 'plugins' => $plugins, 'loader' => $loader), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);`
}
