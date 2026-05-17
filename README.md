# Sandbox Runtime

Portable TypeScript substrate for isolated application runtimes. WordPress Playground is the first backend.

## Thesis

Sandbox Runtime is not an app, an agent framework, or a CI harness. It is a small runtime contract for app and agent platforms that need to create isolated environments, mount inputs, execute controlled actions, observe state, and export artifacts.

```text
App or agent platform
  -> Sandbox Runtime contract
  -> Backend adapter
  -> Isolated environment
  -> Artifact bundle
```

The flagship use case is real-time, sandboxed coding inside application environments. A product can let a user chat with an agent, run the work inside a disposable sandbox, stream observations, and apply only the resulting artifact to a real project or site.

For WordPress, this means a control plane such as Studio, Data Machine, or WordPress.com can run agents against WordPress Playground sandboxes instead of granting broad access to production sites, local machines, or CI-only harnesses.

## Packages

- `@chubes4/sandbox-runtime-core`: backend-agnostic runtime interfaces and shared types.
- `@chubes4/sandbox-runtime-playground`: first backend adapter shaped around WordPress Playground.

## v0 Demo

```bash
npm install
npm run hello-runtime -- ./examples/simple-plugin
```

Expected output:

```text
Booted runtime: wordpress-playground
Mounted: simple-plugin
Executed: inspect-mounted-inputs
Collected artifacts: artifacts/run-...
Destroyed runtime
```

The current backend is a foundation stub. It validates the contract and artifact shape before wiring the real Playground runtime.

## Non-Goals

- Replace Homeboy.
- Replace Agents API.
- Replace WP AI Client.
- Implement provider auth or Codex integration in v0.
- Couple the top-level contract to WordPress-specific concepts.

## Product Direction

Sandbox Runtime should make isolated app sandboxes usable from real-time products, not only CI or operator tools.

```text
User request
  -> control plane creates sandbox task
  -> backend boots isolated runtime
  -> agent or workflow acts inside the sandbox
  -> runtime collects evidence and artifacts
  -> user/app applies, exports, or discards the result
```

The first backend is WordPress Playground. Future consumers can include Studio, Data Machine Code, wp-gym, world-of-wordpress, WordPress.com product surfaces, and CI/eval runners.

## Related Issues

- https://github.com/chubes4/sandbox-runtime/issues/1
- https://github.com/chubes4/sandbox-runtime/issues/2
- https://github.com/chubes4/sandbox-runtime/issues/3
- https://github.com/chubes4/sandbox-runtime/issues/4
- https://github.com/chubes4/sandbox-runtime/issues/5
- https://github.com/chubes4/sandbox-runtime/issues/6
- https://github.com/chubes4/sandbox-runtime/issues/7
