# ADR-0001: Plugin architecture core (language-agnostic)

- **Status:** accepted (v1.0, 2026-04-16)
- **Date:** 2026-04-16
- **Supersedes:** dagstack/plugin-system-python/docs/adr/0001 (Python-centric version) — moves to status `python-binding addendum`.
- **Related:**
  - ADR-0002 — Hook invocation semantics.
  - ADR-0003 — Orchestration-neutral plugin runtime.
  - ADR-0004 — Hookspec formalism (the choice of YAML+JSON Schema → emit-targets).

> **What this is:** a language-agnostic statement of «what every dagstack-core implementation MUST contain» (Python, TypeScript, Go, ...). Concrete bindings — pluggy/pydantic/importlib for Python, zod/package.json for TS — live in `dagstack/<lang>/docs/adr/`.

---

## Context

dagstack is a plugin framework for typical applications where extension points evolve over time (backend connectors, processors, orchestrators, tool integrations). Goal: a consumer team builds its application core with domain-specific kinds; plugin authors implement hookspecs without modifying that core.

Properties dagstack guarantees **independent of the implementation language**:
- The consumer team writes implementations of extension points without modifying core.
- Third-party contributors distribute plugins through the relevant language's private or public registry (PyPI, npm, Go modules).
- Versioning of the core and plugins is explicit and verifiable (see DST-0001 §Versioning).
- A plugin can be isolated as a separate service (sandbox for external code, a different language, a different process) — through the `mcp_stdio` / `mcp_http` runtime.

## Decision drivers

1. **Many extension points.** Domain-specific kinds are declared by the consumer, not by the framework. Kind registration is a runtime API.
2. **Three distribution paths simultaneously:**
   - **A — in-tree** — a plugins folder inside the consumer's monorepo;
   - **B — monorepo packages** — separate distributables in a private registry;
   - **C — public packages** — install from PyPI / npm / a Go module registry.
3. **Compatibility checks:** a plugin declares a range of supported core versions; on registration, the core validates and refuses to load incompatible plugins with a clear error.
4. **Optional process isolation** — a plugin may run in-process or as a separate microservice/subprocess. The decision is per-plugin, not global.
5. **MCP as cross-language wire** — MCP (Model Context Protocol, JSON-RPC 2.0 over stdio/HTTP) is already cross-language. Out-of-process plugins talk to the host through MCP regardless of the host's and the plugin's languages.

## Decision

Every dagstack core implementation (Python, TypeScript, Go, ...) consists of:

1. **Manifest schema** — JSON Schema 2020-12 (source of truth — `dagstack/plugin-system-spec/_meta/manifest.schema.json`).
2. **Hook dispatcher** — handles registration, dispatch, and lifecycle (details in ADR-0002 §dispatch and below in §Lifecycle).
3. **PluginRegistry** — a wrapper over the dispatcher: validation, discovery, lifecycle setup.
4. **PluginContext** — a DI container for cross-cutting services (logger, config, metrics, tracer, event bus, registry, optional tenant). Passed into `setup()`.
5. **Adapters** — `in_process` (native to the language) plus `mcp_stdio` and `mcp_http` (identical in every language).
6. **Contract test framework** — mandatory scenarios (manifest validity, lifecycle clean teardown, leak detection).

### Manifest

Every plugin declares a manifest in one of the standard formats:
- `dagstack-plugin.toml` (Python convention),
- `dagstack-plugin.json` (TS/Node convention),
- a `[tool.dagstack.plugin]` section in `pyproject.toml` / a `dagstack` field in `package.json`,
- an inline dict in a manifest bundle for an admin API.

**Minimum required fields** (the full schema is in `_meta/manifest.schema.json`):

| Field | Type | Purpose |
|---|---|---|
| `schema_version` | string | Version of `manifest.schema.json` (current value = `"1"`). |
| `name` | string | Globally unique within the consumer's namespace. |
| `kind` | string | Plugin kind drawn from the consumer's taxonomy (`tool`, `orchestrator`, ...). See `kinds/`. |
| `kind_api_version` | string | Major version of the kind that the plugin implements (`"1"`, `"2"`). |
| `core_version` | string (PEP 440) | Range of compatible core versions (`">=0.2.0,<0.3.0"`). |
| `runtime` | enum | `in_process` / `mcp_stdio` / `mcp_http`. |

**Optional metadata:** `license`, `maintainer`, `homepage`, `capabilities` (security declaration), `config_schema`, `priority`, `depends_on`, `supports_*` (capability dispatch — ADR-0002 §4), `execution_model`, `resources` (ADR-0003 §3), `unit_of_work` (ADR-0003 §5).

### Runtime-specific entry-point fields

- `in_process` — field `entry_point` (format is language-specific; Python: `"module.path:ClassName"`, TS: `"./dist/index.js"`).
- `mcp_stdio` — fields `command: string[]`, `env: dict`. The plugin language is unconstrained (Python/Node/Rust/Go/...).
- `mcp_http` — fields `url: string`, `auth: dict`. The plugin runs as a separate service.

### Runtime comparison

| Criterion | `in_process` | `mcp_stdio` | `mcp_http` |
|---|---|---|---|
| **Plugin language** | host language only | any | any |
| **Isolation** | none (shared memory) | process | process + network |
| **Latency** | 0 (native call) | ~1-5 ms (IPC) | ~10-200 ms (network) |
| **Cold start** | 0 | ~50-500 ms (process startup) | 0 if the service is already running |
| **Best fit** | hot path, frequent in-loop calls | local tools, incompatible deps, native perf | SaaS integrations, heavy compute, ML |

Custom protocols (REST, gRPC) are not forbidden, but it is recommended to wrap them in a thin MCP proxy so that `MCPHttpAdapter` can be reused. That keeps the plugin compatible across every language.

## Validation at registration

Every core implementation runs the following checks **in this order**:

```
1. schema_version matches the value the core expects.
2. kind ∈ the known set (the consumer registers its kinds with the Registry).
3. kind_api_version ∈ SUPPORTED_API_VERSIONS[kind] for this core.
4. core_version specifier matches the actual core version.
5. runtime ∈ {"in_process", "mcp_stdio", "mcp_http"}.
6. config_schema is valid (json-schema compile).
7. runtime-specific:
   - in_process — language-specific resolve of entry_point + instantiate.
   - mcp_stdio — spawn subprocess + MCP handshake.
   - mcp_http — HTTP connect + MCP handshake.
```

**Failure handling:** an incompatible plugin is not loaded; it is registered as `unavailable` with a clear error. The application does not crash, the rest of the plugins keep working.

## Plugin lifecycle

Every plugin implements three required methods (names and signatures are language-specific, semantics are shared):

| Method | Semantics |
|---|---|
| `setup(ctx: PluginContext)` | Initialization — DI of resources, registration on the event bus, eager init. May be async. |
| `teardown() -> bool` | Cleanup. Returns `true` if every resource has been released and the plugin can be reloaded without restarting the process. `false` → the Registry marks the plugin `requires_restart`. |
| `health() -> HealthStatus` | A polling health check. Used eagerly during setup and periodically for monitoring. |

### Cancel semantics for in-flight operations

Before calling `teardown()`, the Registry hands the plugin the list of active operations through `ctx.in_flight()`. The plugin MUST either wait (with a timeout) or cancel them. Otherwise a reload during active processing is a contract violation.

### Reload semantics

`reload(plugin)` = `teardown(old) → setup(new instance)`. The old instance MUST be fully reclaimed by GC (or its equivalent in a language without GC). No «hot patching» — only a fresh instance.

### Leak detection (mandatory contract test)

Every core MUST provide a contract-test framework that verifies, after `teardown()`:
- No object leaks via weak references / equivalent (Go: SetFinalizer; Python: weakref + gc.collect).
- No dangling async tasks / goroutines / promises.
- Open file descriptors do not grow.
- (Phase 1+) `tracemalloc`-equivalent snapshot diff does not exceed the threshold.

Implementation details live in `dagstack/<lang>/docs/adr/`.

## PluginContext — required fields

Field structure (names follow the language's casing — snake_case / camelCase / PascalCase, **the semantics are shared**):

| Field | Purpose | Required? |
|---|---|---|
| `config` | Validated user settings for the plugin (per `config_schema`). | required |
| `logger` | A logger that automatically prefixes with `plugin.<name>`. | required |
| `registry` | A reference to the PluginRegistry for cross-plugin DI. | required |
| `metrics` | A recorder with auto-labels `plugin=<name>`, `kind=<kind>`. | recommended |
| `tracer` | Distributed tracer (OpenTelemetry-compatible in Python/TS/Go). | recommended |
| `event_bus` | Pub/sub interface (see §EventBus). | optional |
| `tenant` | A `TenantContext` for multi-tenant consumers (default is a NoOp). | optional |
| `metadata` | An open `Mapping[str, Any]` slot for horizontal concerns (governance/quota/observability — see ADR-0005). Canonical keys: `tenant_id`, `actor`, `quota_budget`, `trace_context`, `request_id`. | required (default empty mapping) |
| `resources` | A DI container of named resources (ADR-0003 §3). | optional (Phase 1+) |
| `progress` | A ProgressSink (ADR-0003 §6). | optional (Phase 1+) |
| `checkpoint` | A CheckpointStore (ADR-0003 §6). | optional (Phase 1+) |
| `in_flight` | A snapshot of the plugin's active operations. | required (for reload) |

Observability is automatically pre-injected — the plugin does not concern itself with labels/spans/prefixes.

## TenantContext — opt-in extension

The default implementation is a NoOpTenantContext (`check_access` always returns OK). A multi-tenant consumer plugs in its own through DI; I/O plugins MUST call `ctx.tenant.check_access(...)` BEFORE any operations on tenant-scoped resources. The concrete mechanism is out of scope for dagstack and lives in the consumer's documentation.

## EventBus — interface fixed, implementation minimal

Interface (Phase 0):
- `publish(topic, payload)` — fire-and-forget.
- `subscribe(topic, handler)` → `subscription`.
- `unsubscribe(subscription)`.

The default implementation is in-process pub/sub (asyncio.Queue / EventEmitter / Go channel — language-specific). At-most-once delivery, no persistence. A message can be lost if the handler crashes.

Persistence (Redis Streams / NATS / RabbitMQ), at-least-once, ordering, durable queues — these are deferred to a separate post-MVP ADR.

## Discovery sources

Every core MUST support at least three plugin-discovery paths:

1. **Explicit register** — programmatic `registry.register_module(my_plugin)`.
2. **Native package convention** — Python `entry_points("dagstack.plugins")`, TS `package.json[dagstack.manifest]`, Go — explicit register only (Go has no dynamic discovery).
3. **Manifest registry** — external plugins (out-of-process), registered via TOML/JSON files inside `<consumer-dir>/plugins_registry/` or via the `DAGSTACK_REMOTE_PLUGINS` environment variable.

## Adapters

Every core implementation ships three adapters:

- **`InProcessAdapter`** — language-specific. Resolves the entry_point, instantiates, and registers with the hook dispatcher. Native speed, shared memory.
- **`MCPStdioAdapter`** — spawns a subprocess, runs JSON-RPC 2.0 over stdin/stdout, performs the MCP handshake, and the core manages the subprocess lifecycle.
- **`MCPHttpAdapter`** — an HTTP client (HTTP+SSE / Streamable HTTP), reconnect on disconnect, auth (bearer / OAuth2), and a retry+CB policy from the manifest.

All three adapters map hookspec methods → MCP tool calls with the same code (where applicable). The adapter is selected by the `runtime` field in the manifest.

### Honest boundaries of the MCP runtime

**Runtime switching is NOT fully transparent.** Hookspec methods fall into two categories:

- **RPC-safe methods:** only serializable types (string, int, float, bool, list/dict primitives, bytes as base64, JSON-Schema-validated structures). Behave identically under `in_process` and the MCP runtimes.
- **In-process-only methods:** return streams (AsyncIterator / async generator / Go channel / Node Readable), complex objects with methods, or cyclic structures. Marked in the hookspec as `mcp_exposed: false` (see ADR-0004 §YAML schema). The Registry refuses to load plugins with an `mcp_*` runtime that implement such hooks.

The MCP runtime requires additional policies (timeouts, retry+CB, backpressure, a marshal layer for typed errors, trace-context propagation) — details in ADR-0003.

## Cold start policy for out-of-process plugins

`mcp_*` plugins start **eagerly** (during lifespan startup), not lazily on the first call. The first user request MUST NOT wait for a cold start.
- `mcp_stdio`: spawn + health check (default timeout 30 s).
- `mcp_http`: HTTP ping + auth check; if the service is unavailable — mark `unavailable` and reconnect in the background.

Plugins in `unavailable` state are visible through the `/api/plugins` equivalent with status and last error. The core starts in degraded mode but stays available.

## Versioning

Three independent SemVer levels (details in `_meta/versioning.md`):

- `spec_schema_version` (currently `"1"`) — the structure of `_meta/manifest.schema.json` and the kind YAML format.
- `kind_api_version`, per-kind, independent. Bumps when the hook signatures of a particular kind change in a breaking way.
- `core_version`, per implementation — `dagstack` (Python), `@dagstack/core` (npm), `go.dagstack.dev/core` (Go). Each core declares the supported spec and kind_api ranges.

### Breaking-change policy for the core public API

The core's public API is `PluginContext`, the hookspecs, the `PluginManifest` schema, and the admin API.

- **Major bump** = breaking. Plugins with `core_version = ">=1.x,<2.0"` refuse to load on `2.0.0` with an explicit error.
- **Minor bump** = additive, backward-compatible. Deprecated fields keep working with a WARN.
- **Deprecation grace period** — at least 2 minor releases (≈ 2-4 months) between an `@deprecated` annotation and removal.

## Supply-chain security for external plugins

External plugins (option C — install from a public registry) open up a class of risks. MVP measures (mandatory in every language):
- **Publisher allow-list** in the core configuration: `DAGSTACK_PLUGIN_TRUSTED_PUBLISHERS`. A plugin not on the list → WARN + `untrusted` in `/api/plugins`.
- **Capability audit** at registration — log `capabilities` (network/filesystem.write/subprocess) into logs/UI.
- **Content hash log** — `content_hash` (sha256 of the wheel/tarball) shown in `/api/plugins` for audit purposes.

**Post-MVP** (separate ADR):
- Plugin signing (sigstore / GPG).
- Capability enforcement (seccomp / AppArmor / gVisor for the MCP runtime).
- A curated marketplace with rating / vulnerability scanning.

## Cross-language naming conventions

Summary (details in `naming/{python,nodejs,golang}.md`):

| Language | Distribution | Import path | Discovery |
|---|---|---|---|
| Python | `dagstack` (PyPI), `dagstack-<plugin>` | PEP 420 namespace `dagstack.plugins.*` | `entry_points("dagstack.plugins")` |
| TypeScript | `@dagstack/core` (npm), `@dagstack/<plugin>` | `@dagstack/<plugin>` direct import | `package.json[dagstack.manifest]` |
| Go | `go.dagstack.dev/core` (vanity), `go.dagstack.dev/plugins/<plugin>` | direct import | explicit register |

## Phase plan

- **Phase 0** — manifest validator, registry skeleton, in-process adapter, contract test framework. **Completed** in `dagstack/plugin-system-python` (plus `dagstack/plugin-system-typescript` Phase 0 skeleton).
- **Phase 1** — all five hook dispatch classes (ADR-0002), lifecycle ordering with `depends_on`, Resources/ProgressSink/CheckpointStore (ADR-0003), pilot-consumer integration.
- **Phase 2** — full MCP stdio/http adapters production-ready, hot-reload as a dev feature.
- **Phase 3** — public release: SemVer 1.0.0 in registries (PyPI / npm / Go), GitHub mirror, plugin author docs.

## Consequences

### Positive

- Any Python/TS/Go plugin gets a stable contract: `dagstack-plugin.toml` plus a per-kind hookspec.
- Version skew is handled explicitly — an incompatible plugin does not load and the error message is clear.
- MCP cross-language — a Python host can call a Node plugin and vice versa with no special wiring.
- Observability is free for plugin authors (auto-prefixed logs, auto-labelled metrics, automatic trace propagation).

### Negative / risks

- **~500-800 LOC of framework code per language** (manifest, registry, adapters, contract tests, context). The price of not having an off-the-shelf solution.
- **Hot reload is honest only for MCP** (process restart). In-process reload is implementable but requires discipline from authors; recommended as dev-only.
- **MCP overhead** depends on the transport: stdio ~1-5 ms per call, http ~10-200 ms — critical for the hot path. Critical plugins MUST be `in_process` or `mcp_stdio`.
- **Per-kind API versioning** — the consumer has to actually maintain it. A breaking change in a kind's hookspec → `kind_api_version: "2"`, and v1 plugins fail before they hit a real bug.

### Streaming via MCP — bounded

Hooks that return streams (AsyncIterator / Readable / channel) are marked `mcp_exposed: false`. They do not work over MCP in Phase 0/1. **MVP workaround:** streaming-capable plugins running under an `mcp_*` runtime return the full response and the consumer chunks it on its side. Post-MVP — MCP progress notifications (separate ADR).

### File uploads through plugins

MVP: a file up to 10 MB is passed as `bytes` / base64 in the payload. Larger files go through an S3/MinIO presigned URL outside the plugin API. Post-MVP — manifest fields `accepts_files`, `max_file_size_mb`, `accepts_mime_types`, plus the MCP resource protocol.

## Open questions

- **OS-level sandbox** (seccomp / namespaces / gVisor) for MCP plugins — for now we rely on docker isolation. This will become relevant when external plugins arrive.
- **Plugin marketplace** — currently only manifests + a private registry; a curated marketplace is a separate effort.
- **State migration** when a plugin upgrade changes the storage schema — to be formalized once the first concrete case appears.
- **Event-bus durable backend** (Redis Streams / RabbitMQ / NATS), at-least-once, persistence, ordering — separate post-MVP ADR.

## Provenance

This pure-spec version was extracted from `dagstack/plugin-system-python/docs/adr/0001-plugin-architecture-core.md` (v1.0, accepted 2026-04-15). Python-specific details (the pluggy choice plus decorators, pydantic as the manifest validator, `importlib.metadata.entry_points` discovery, `subprocess.Popen` for mcp_stdio, `httpx.AsyncClient` for mcp_http, FastAPI lifespan, asyncio task management, gc/weakref/tracemalloc for leak detection, GIL+async policy) were moved into the Python binding addendum (after the rework — `dagstack/plugin-system-python/docs/adr/0001-binding.md`).

Numbering correspondence:
| dagstack/plugin-system-spec | dagstack/plugin-system-python (binding) | Pilot consumer (historical upstream) |
|---|---|---|
| ADR-0001 | python ADR-0001-binding | pilot ADR-0001 v6.4 |

## References

- ADR-0002 — Hook invocation semantics.
- ADR-0003 — Orchestration-neutral runtime.
- ADR-0004 — Hookspec formalism (this ADR refers to the YAML+JSON Schema source-of-truth for hookspecs).
- [MCP specification](https://modelcontextprotocol.io/specification).
- [PEP 440 version specifiers](https://peps.python.org/pep-0440/) — semantics for the `core_version` field independently of the language.
