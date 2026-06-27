import { runtimeCommandDefinitions } from "./command-registry.js"
import { fuzzCoveragePlanContract, type FuzzCoveragePlanContract, type FuzzCoveragePlanItem, type FuzzCoveragePlanParameterGenerationHook } from "./fuzz-coverage-plan-contracts.js"
import { stripUndefined } from "./object-utils.js"
import { WORDPRESS_ADMIN_PAGE_INVENTORY_SCHEMA, WORDPRESS_DATABASE_INVENTORY_SCHEMA, WORDPRESS_FRONTEND_URL_INVENTORY_SCHEMA, WORDPRESS_REST_ROUTE_INVENTORY_SCHEMA, type WordPressRuntimeDiscoveryResult, type WordPressEditorPostTypeDescriptor } from "./wordpress-runtime-discovery-contracts.js"
import { WORDPRESS_CRUD_OPERATION_SCHEMA, normalizeWordPressCrudOperation, type WordPressCrudOperation, type WordPressCrudResourceRef, type WordPressCrudVerb } from "./wordpress-crud-contracts.js"
import { adminPageInventoryToCoveragePlan, databaseInventoryToCoveragePlan, frontendUrlInventoryToCoveragePlan, restRouteInventoryToCoveragePlan, type WordPressInventoryFuzzSuiteOptions } from "./wordpress-fuzz-suite-builders.js"
import { wordpressBlockDiscoveryToCoveragePlan, type WordPressBlockFuzzSuiteOptions } from "./wordpress-block-fuzz-suite.js"

export interface WordPressRuntimeDiscoveryCoveragePlanOptions extends WordPressInventoryFuzzSuiteOptions, Pick<WordPressBlockFuzzSuiteOptions, "editorPostType" | "includeEditorInsert" | "includeServerRender" | "capture"> {
  includeCrudResources?: boolean
  includePageLoadModes?: boolean
}

const CRUD_OPERATION_TARGET = {
  kind: "runtime",
  id: "wordpress.crud-operation",
  entrypoint: "wordpress.crud-operation",
  label: "WordPress CRUD operation",
}

const PAGE_LOAD_MODE_COMMANDS = [
  { command: "wordpress.simulated-admin-page-load", surface: "admin", mode: "simulated" },
  { command: "wordpress.simulated-frontend-page-load", surface: "frontend", mode: "simulated" },
  { command: "wordpress.server-page-load", surface: "frontend", mode: "server" },
  { command: "wordpress.browser-page-load", surface: "frontend", mode: "browser" },
] as const

const CRUD_RESOURCE_IDENTIFIER_HOOK: FuzzCoveragePlanParameterGenerationHook = {
  id: "wordpress.crud-resource-identifiers",
  label: "WordPress CRUD resource identifier generator",
  description: "Placeholder hook for consumers that can discover concrete item identifiers for a generic WordPress CRUD resource.",
}

export function wordpressRuntimeDiscoveryToCoveragePlan(discovery: WordPressRuntimeDiscoveryResult, options: WordPressRuntimeDiscoveryCoveragePlanOptions = {}): FuzzCoveragePlanContract {
  const plans: FuzzCoveragePlanContract[] = []

  if (discovery.rest) {
    plans.push(restRouteInventoryToCoveragePlan({ schema: WORDPRESS_REST_ROUTE_INVENTORY_SCHEMA, command: "wordpress.rest-route-inventory", status: "ok", routes: discovery.rest.routes, namespaces: discovery.rest.namespaces, diagnostics: discovery.diagnostics.filter((diagnostic) => diagnostic.surface === "rest") }, options))
  }
  if (discovery.admin) {
    plans.push(adminPageInventoryToCoveragePlan({ schema: WORDPRESS_ADMIN_PAGE_INVENTORY_SCHEMA, command: "wordpress.admin-page-inventory", status: discovery.admin.menuLoaded ? "ok" : "unsupported", adminUrl: discovery.admin.adminUrl, menuLoaded: discovery.admin.menuLoaded, user: discovery.admin.user, pages: discovery.admin.pages, diagnostics: discovery.diagnostics.filter((diagnostic) => diagnostic.surface === "admin") }, options))
  }
  if (discovery.frontend) {
    const urls = [{ url: discovery.frontend.homeUrl, source: "home" as const }, ...discovery.frontend.rewriteRules.map((rule) => ({ url: new URL(rule.pattern.replace(/^\^|\??\$$/g, ""), discovery.frontend?.homeUrl).toString(), source: "rewrite-rule" as const, pattern: rule.pattern, query: rule.query }))]
    plans.push(frontendUrlInventoryToCoveragePlan({ schema: WORDPRESS_FRONTEND_URL_INVENTORY_SCHEMA, command: "wordpress.frontend-url-inventory", status: "ok", homeUrl: discovery.frontend.homeUrl, permalinkStructure: discovery.frontend.permalinkStructure, urls, rewriteRules: discovery.frontend.rewriteRules, publicQueryVars: discovery.frontend.publicQueryVars, diagnostics: discovery.diagnostics.filter((diagnostic) => diagnostic.surface === "frontend") }, options))
  }
  if (discovery.database) {
    const tables = discovery.database.tables
    plans.push(databaseInventoryToCoveragePlan({ schema: WORDPRESS_DATABASE_INVENTORY_SCHEMA, command: "wordpress.inventory-database", status: "ok", prefix: discovery.database.prefix, tables, totals: { tableCount: tables.length, rowCount: 0, columnCount: tables.reduce((total, table) => total + table.columns.length, 0), indexCount: tables.reduce((total, table) => total + (table.indexes?.length ?? 0), 0), dataBytes: 0, indexBytes: 0, totalBytes: 0 }, diagnostics: discovery.diagnostics.filter((diagnostic) => diagnostic.surface === "database") }, options))
  }
  if (discovery.blocks) {
    plans.push(wordpressBlockDiscoveryToCoveragePlan(discovery.blocks, options))
  }

  const crudItems = options.includeCrudResources === false ? [] : crudResourceCoverageItems(discovery.blocks?.editorPostTypes ?? [], options)
  const pageLoadItems = options.includePageLoadModes === false ? [] : pageLoadModeCoverageItems(options)
  const discoveredItems = [...plans.flatMap((plan) => plan.discovered), ...crudItems, ...pageLoadItems].map(withRequiredRunnerCapabilities)
  const generated = [...plans.flatMap((plan) => plan.generated), ...crudItems.filter((item) => item.input !== undefined), ...pageLoadItems.filter((item) => item.input !== undefined)].map(withRequiredRunnerCapabilities)
  const executable = [...plans.flatMap((plan) => plan.executable), ...crudItems.filter((item) => item.input !== undefined && !item.reason), ...pageLoadItems.filter((item) => item.input !== undefined && !item.reason)].map(withRequiredRunnerCapabilities)
  const skipped = plans.flatMap((plan) => plan.skipped).map(withRequiredRunnerCapabilities)
  const untested = [...plans.flatMap((plan) => plan.untested), ...crudItems.filter((item) => item.reason)].map(withRequiredRunnerCapabilities)

  return fuzzCoveragePlanContract({
    id: options.id ?? "wordpress-runtime-discovery-coverage-plan",
    version: options.version,
    discovered: discoveredItems,
    generated,
    executable,
    skipped,
    untested,
    parameterGenerationHooks: dedupeHooks([...plans.flatMap((plan) => plan.parameterGenerationHooks ?? []), CRUD_RESOURCE_IDENTIFIER_HOOK]),
    metadata: stripUndefined({ ...options.metadata, sourceSchema: discovery.schema, sourceCommand: discovery.command, surfaces: discovery.surfaces }),
  })
}

function crudResourceCoverageItems(postTypes: readonly WordPressEditorPostTypeDescriptor[], options: WordPressRuntimeDiscoveryCoveragePlanOptions): FuzzCoveragePlanItem[] {
  const postResources = postTypes.flatMap((postType) => [
    crudResourceItem({ id: postType.name, label: postType.name, resource: { kind: "post", type: postType.name, route: `/wp/v2/${postType.restBase}` }, operation: "list", query: { limit: 1, status: "any" }, metadata: { postType: postType.name, restBase: postType.restBase }, options }),
    crudResourceItem({ id: postType.name, label: postType.name, resource: { kind: "post", type: postType.name, route: `/wp/v2/${postType.restBase}` }, operation: "read", requiredInputs: ["id"], metadata: { postType: postType.name, restBase: postType.restBase }, options }),
  ])

  return [
    ...postResources,
    crudResourceItem({ id: "term-category", label: "category term", resource: { kind: "term", type: "category" }, operation: "list", query: { limit: 1 }, options }),
    crudResourceItem({ id: "term-category", label: "category term", resource: { kind: "term", type: "category" }, operation: "read", requiredInputs: ["id"], options }),
    crudResourceItem({ id: "comment", label: "comment", resource: { kind: "comment" }, operation: "list", query: { limit: 1 }, options }),
    crudResourceItem({ id: "comment", label: "comment", resource: { kind: "comment" }, operation: "read", requiredInputs: ["id"], options }),
    crudResourceItem({ id: "attachment", label: "attachment", resource: { kind: "attachment" }, operation: "list", query: { limit: 1, status: "any" }, options }),
    crudResourceItem({ id: "attachment", label: "attachment", resource: { kind: "attachment" }, operation: "read", requiredInputs: ["id"], options }),
    crudResourceItem({ id: "user", label: "user", resource: { kind: "user" }, operation: "list", query: { limit: 1 }, options }),
    crudResourceItem({ id: "user", label: "user", resource: { kind: "user" }, operation: "read", requiredInputs: ["id"], options }),
    crudResourceItem({ id: "option", label: "option", resource: { kind: "option" }, operation: "list", query: { limit: 1 }, options }),
    crudResourceItem({ id: "option", label: "option", resource: { kind: "option" }, operation: "read", requiredInputs: ["name"], options }),
    crudResourceItem({ id: "metadata-post", label: "post metadata", resource: { kind: "metadata", type: "post" }, operation: "list", requiredInputs: ["object_id", "key"], options }),
    crudResourceItem({ id: "metadata-post", label: "post metadata", resource: { kind: "metadata", type: "post" }, operation: "read", requiredInputs: ["object_id", "key"], options }),
  ]
}

function crudResourceItem(input: { id: string, label: string, resource: WordPressCrudResourceRef, operation: "list" | "read", query?: Record<string, unknown>, requiredInputs?: string[], metadata?: Record<string, unknown>, options: WordPressRuntimeDiscoveryCoveragePlanOptions }): FuzzCoveragePlanItem {
  const executable = !input.requiredInputs?.length
  const op = crudOperation({ operation: input.operation, resource: input.resource, query: input.query })
  return stripUndefined({
    id: `crud-${input.operation}-${caseIdPart(input.id)}`,
    target: CRUD_OPERATION_TARGET,
    description: `${input.operation} ${input.label} through the generic WordPress CRUD operation contract.`,
    input: executable ? { args: [`operation-json=${JSON.stringify(op)}`] } : undefined,
    reason: executable ? undefined : { code: "crud_resource_identifier_required", message: "The discovered CRUD resource requires concrete identifiers before coverage can execute.", data: { resource: input.resource.kind, type: input.resource.type, requiredInputs: input.requiredInputs } },
    parameterGeneration: executable ? undefined : { hook: "wordpress.crud-resource-identifiers", requiredInputs: input.requiredInputs },
    metadata: { source: "wordpress-runtime-discovery", surface: "crud", operation: input.operation, resource: input.resource, ...input.metadata, observationCapture: captureMetadata(input.options) },
  })
}

function crudOperation(input: { operation: WordPressCrudVerb, resource: WordPressCrudResourceRef, query?: Record<string, unknown> }): WordPressCrudOperation {
  return normalizeWordPressCrudOperation({ schema: WORDPRESS_CRUD_OPERATION_SCHEMA, operation: input.operation, resource: input.resource, query: input.query, metadata: { source: "wordpress-runtime-discovery" } })
}

function pageLoadModeCoverageItems(options: WordPressRuntimeDiscoveryCoveragePlanOptions): FuzzCoveragePlanItem[] {
  const commands = new Map(runtimeCommandDefinitions().map((command) => [command.id, command]))
  return PAGE_LOAD_MODE_COMMANDS.flatMap(({ command, surface, mode }) => {
    const definition = commands.get(command)
    if (!definition || definition.metadata?.excludeFromFuzzTargets) return []
    return [{
      id: `page-load-mode-${caseIdPart(command)}`,
      target: { kind: "command", id: command, entrypoint: command, label: definition.description, metadata: { surface, pageLoadMode: mode } },
      description: `Coverage target for ${mode} ${surface} page-load mode.`,
      input: { args: [surface === "admin" ? "path=index.php" : "path=/", ...(mode === "server" || mode === "browser" ? [`surface=${surface}`] : [])] },
      metadata: { source: "runtime-command-registry", surface: "page-load-mode", command, pageLoadMode: mode, observationCapture: captureMetadata(options), requiredRunnerCapabilities: { capabilities: ["target:command"], targetKinds: ["command"], commands: [command] } },
    }]
  })
}

function captureMetadata(options: WordPressRuntimeDiscoveryCoveragePlanOptions): Record<string, unknown> {
  return options.capture?.length
    ? { status: "requested-not-captured", requested: [...options.capture], supported: false, reason: "coverage-plan-generation-does-not-capture-runtime-observations" }
    : missingCaptureMetadata()
}

function missingCaptureMetadata(): Record<string, unknown> {
  return { status: "not-requested", supported: false, reason: "coverage-plan-generation-does-not-capture-runtime-observations" }
}

function withRequiredRunnerCapabilities(item: FuzzCoveragePlanItem): FuzzCoveragePlanItem {
  if (item.metadata?.requiredRunnerCapabilities) return item
  const command = item.target?.entrypoint ?? item.target?.id
  return {
    ...item,
    metadata: stripUndefined({
      ...item.metadata,
      requiredRunnerCapabilities: stripUndefined({
        capabilities: requiredCapabilitiesForTarget(item),
        targetKinds: item.target?.kind ? [item.target.kind] : undefined,
        commands: command ? [command] : undefined,
      }),
    }),
  }
}

function requiredCapabilitiesForTarget(item: FuzzCoveragePlanItem): string[] | undefined {
  const kind = item.target?.kind
  if (!kind) return undefined
  const capabilities = [`target:${kind}`]
  if (kind === "runtime") capabilities.push("runtime")
  if (item.target?.entrypoint === "wordpress.db-operation") capabilities.push("db_operation")
  return capabilities
}

function dedupeHooks(hooks: readonly FuzzCoveragePlanParameterGenerationHook[]): FuzzCoveragePlanParameterGenerationHook[] {
  const seen = new Set<string>()
  return hooks.filter((hook) => {
    if (seen.has(hook.id)) return false
    seen.add(hook.id)
    return true
  })
}

function caseIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unnamed"
}
