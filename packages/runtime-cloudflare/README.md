# Cloudflare Runtime Gate

This additive integration is the first acceptance gate for [wp-codebox#1838](https://github.com/Automattic/wp-codebox/issues/1838). It compiles the current PHP 8.5 Asyncify Wasm asset for workerd, boots WordPress through Playground with the current SQLite integration release, executes PHP, and returns a Codebox runtime-command-result envelope containing the stable `wp-codebox/cloudflare-runtime-health/v1` health payload.

The Worker owns Cloudflare transport, PHP-WASM execution, and the caller-owned disposable SQLite cache. [MDI PR #126](https://github.com/Automattic/markdown-database-integration/pull/126), pinned at `94b9f875ffb8402d5e8eb726893a12324e20f45c`, supplies the constrained public primary runtime: normal MDI driver SQL writes are explicitly flushed to deterministic relative Markdown/JSON paths. R2 stores immutable canonical revisions and the current pointer; the Durable Object owns only the persisted lease, base-revision validation, and CAS pointer promotion. SQLite is never uploaded. This preserves cold reconstruction from canonical R2 files and concurrent mutation serialization without expanding MDI's storage-only boundary.

Existing evidence covers full WordPress initialization and canonical R2 revision behavior. This update changes the source relationship from ad hoc writes to MDI's public constrained runtime, adds source-level bundle and mutation guards, and supports local packaging verification. It does not claim a new remote deployment.

## Verification

1. Install dependencies with `npm ci`.
2. Run `npm run build`; expect the existing Codebox packages to compile.
3. Run `npm run test:cloudflare-runtime`; expect the deterministic health response to contain the Codebox command-result schema and boot/execution evidence.
4. Run `npm run cloudflare:dry-run`; expect Wrangler to compile the Worker and report the Worker bundle size. This creates no Cloudflare resources.
5. Run `npm run cloudflare:local-gate`; expect two HTTP 200 health envelopes from local workerd and automatic server cleanup. This validates packaging and the real Worker boot path.
6. After configuring a Cloudflare account and an explicit deployment target, run `npm exec -- wrangler deploy --config packages/runtime-cloudflare/wrangler.jsonc`; request the deployed URL and expect `marker: "wp-codebox-cloudflare-runtime-health"`, WordPress and PHP versions, and completed initialization/execution evidence.
7. Remove the deployed Worker with `npm exec -- wrangler delete --config packages/runtime-cloudflare/wrangler.jsonc` when the remote gate is no longer needed.

The remote request in step 6 is the memory and boot acceptance gate. Cloudflare Workers enforces the 128 MB isolate limit remotely; a local workerd result does not establish that limit.
