# Portable Sandbox Runtime With WordPress Playground Backend

## Problem

Homeboy proves that isolated WordPress environments are powerful for CI, benchmarks, evidence capture, and repeatable investigations. Studio and other real-time applications need the same principle in an embeddable TypeScript shape: start a sandbox now, stream/observe work, collect artifacts, and let the user apply or discard results without waiting for CI.

## Proposal

Define a small backend-agnostic runtime contract:

```text
create -> mount -> execute -> observe -> snapshot -> collect artifacts -> destroy
```

WordPress Playground is the first backend because it provides a cheap, portable, reproducible application runtime for WordPress workloads. The contract remains broader than WordPress so future backends can implement the same interface.

## Boundary

- **Homeboy** remains the operator/CI/evidence harness.
- **Agents API** owns agent identity, sessions, tools, and run loops.
- **WP AI Client** owns model/provider prompt execution.
- **Connectors API** owns external service auth and credential configuration.
- **Sandbox Runtime** owns isolated environments, mounts, execution policy, observations, snapshots, and artifacts.

## First Milestone

Hello Runtime:

1. Define runtime-core interfaces.
2. Implement a Playground-shaped backend stub.
3. Mount a sample plugin directory.
4. Execute a controlled action.
5. Write an artifact bundle.
6. Destroy the runtime.

This milestone proves the API and artifact shape before integrating real Playground execution.
