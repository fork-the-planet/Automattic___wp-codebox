import { stripUndefined } from "./object-utils.js"
import type { FuzzSuiteResetPolicy } from "./fuzz-suite-contracts.js"

export const FUZZ_FIXTURE_PLAN_SCHEMA = "wp-codebox/fuzz-fixture-plan/v1" as const
export const REST_MUTATION_FIXTURE_OPT_IN_SCHEMA = "wp-codebox/rest-mutation-fixture-opt-in/v1" as const

export type FuzzFixtureOperationKind = "crud" | "read" | "mutation" | (string & {})
export type FuzzFixtureMutationMethod = "POST" | "PUT" | "PATCH" | "DELETE" | (string & {})

export interface FuzzFixtureResourceRef {
  kind: string
  id?: string
  name?: string
  metadata?: Record<string, unknown>
}

export interface FuzzFixtureSeedOperation {
  id: string
  kind: FuzzFixtureOperationKind
  resource?: FuzzFixtureResourceRef
  method?: string
  target?: string
  input?: unknown
  expected?: unknown
  metadata?: Record<string, unknown>
}

export interface FuzzFixturePlanContract {
  schema: typeof FUZZ_FIXTURE_PLAN_SCHEMA
  id: string
  version?: string
  operations: FuzzFixtureSeedOperation[]
  operationKinds: string[]
  metadata?: Record<string, unknown>
}

export interface RestMutationFixtureOptInContract {
  schema: typeof REST_MUTATION_FIXTURE_OPT_IN_SCHEMA
  id: string
  route: string
  methods: FuzzFixtureMutationMethod[]
  auth?: RestMutationAuthPolicy
  rollbackPolicy?: FuzzSuiteResetPolicy
  rollback_policy?: FuzzSuiteResetPolicy
  fixturePlan?: FuzzFixturePlanContract
  fixturePlanRef?: string
  metadata?: Record<string, unknown>
}

export interface RestMutationAuthPolicy {
  user?: string
  session?: string
  headers?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export function fuzzFixturePlanContract(input: {
  id: string
  version?: string
  operations?: FuzzFixtureSeedOperation[]
  metadata?: Record<string, unknown>
}): FuzzFixturePlanContract {
  const operations = input.operations ?? []
  return stripUndefined({
    schema: FUZZ_FIXTURE_PLAN_SCHEMA,
    id: input.id,
    version: input.version,
    operations,
    operationKinds: dedupeStrings(operations.map((operation) => operation.kind)),
    metadata: input.metadata,
  })
}

export function crudFixtureSeedOperation(input: Omit<FuzzFixtureSeedOperation, "kind">): FuzzFixtureSeedOperation {
  return fuzzFixtureSeedOperation({ ...input, kind: "crud" })
}

export function readFixtureSeedOperation(input: Omit<FuzzFixtureSeedOperation, "kind">): FuzzFixtureSeedOperation {
  return fuzzFixtureSeedOperation({ ...input, kind: "read" })
}

export function mutationFixtureSeedOperation(input: Omit<FuzzFixtureSeedOperation, "kind">): FuzzFixtureSeedOperation {
  return fuzzFixtureSeedOperation({ ...input, kind: "mutation" })
}

export function restMutationFixtureOptInContract(input: {
  id: string
  route: string
  methods: readonly string[]
  auth?: RestMutationAuthPolicy
  rollbackPolicy?: FuzzSuiteResetPolicy
  rollback_policy?: FuzzSuiteResetPolicy
  fixturePlan?: FuzzFixturePlanContract
  fixturePlanRef?: string
  metadata?: Record<string, unknown>
}): RestMutationFixtureOptInContract {
  return stripUndefined({
    schema: REST_MUTATION_FIXTURE_OPT_IN_SCHEMA,
    id: input.id,
    route: input.route,
    methods: dedupeStrings(input.methods.map((method) => method.toUpperCase())) as FuzzFixtureMutationMethod[],
    auth: input.auth,
    rollbackPolicy: input.rollbackPolicy,
    rollback_policy: input.rollback_policy,
    fixturePlan: input.fixturePlan,
    fixturePlanRef: input.fixturePlanRef,
    metadata: input.metadata,
  })
}

function fuzzFixtureSeedOperation(input: FuzzFixtureSeedOperation): FuzzFixtureSeedOperation {
  return stripUndefined({
    id: input.id,
    kind: input.kind,
    resource: input.resource,
    method: input.method,
    target: input.target,
    input: input.input,
    expected: input.expected,
    metadata: input.metadata,
  })
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => Boolean(value)))]
}
