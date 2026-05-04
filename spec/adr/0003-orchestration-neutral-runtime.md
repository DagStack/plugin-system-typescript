# ADR-0003: Orchestration-neutral plugin runtime (language-agnostic)

- **Status:** accepted (v1.0, 2026-04-16)
- **Date:** 2026-04-16
- **Supersedes:** dagstack/plugin-system-python/docs/adr/0003 (Python-centric version) — moves to status `python-binding addendum`.
- **Related:**
  - ADR-0001 — Plugin architecture core.
  - ADR-0002 — Hook invocation semantics.
  - ADR-0004 — Hookspec formalism (`execution_model` field in YAML).

> **What this is:** eight runtime-contract invariants that every plugin MUST satisfy in every language, plus the new `orchestrator` kind. Concrete bindings (`httpx.AsyncClient` for resources, `pydantic.model_dump` for checkpoints, `asyncio.Lock` for sync primitives) live in `dagstack/<lang>/docs/adr/`.

---

## Context

DST-0001 introduced runtime adapters (`in_process` / `mcp_stdio` / `mcp_http`) and implies that "a plugin does not know where it is executed." It did not, however, enumerate the concrete **invariants** that guarantee this property. As long as the only caller is the consumer's in-process executor, violations remain hidden: an ambient event loop, shared singletons, and filesystem state all just work.

Two factors are now emerging that **break** this property unless the invariants are pinned down before plugin implementations multiply:

1. **Scale to 10⁴+ partitions** — re-running a UoW requires a task queue with priorities, retries, backfill, and audit.
2. **External orchestrator as a plugin kind** (Dagster, Celery, Airflow, k8s Job — any of them) — the plugin must run in a separate process / pod, progress streams through an abstract sink, and checkpoints land in Postgres.

If long-running plugins start relying on an ambient event loop, process singletons, or local filesystem state, the migration becomes painful — every plugin must be rewritten to fit the orchestrator contract. It is cheaper to fix the constraints now.

`in_process_only` plugins (DST-0001) are exempt from some requirements but still MUST satisfy §3 (resources DI), §4 (sync/async declaration), §6 (abstract progress sink), and §7 (idempotency).

## Eight runtime-contract invariants

### 1. Orchestration-neutrality (ambient state ban)

A plugin MUST NOT rely on the host's ambient state. Forbidden:

- Relying on the current event loop / executor / runtime context at initialization time (`get_current_loop()` in a constructor, `Tokio::current()` without a context).
- Reading or writing process-level singletons (thread-locals, module-level mutable state, "the global client").
- Using the filesystem outside paths injected through `PluginContext`.
- Reading environment variables outside `setup()` (env MUST be read and cached — otherwise different workers see different values in distributed scenarios).
- Relying on the current working directory.

**Consequence.** A plugin behaves identically when invoked:
- from the consumer's in-process executor (shared event loop);
- from an orchestrator op (a separate process, a fresh event loop per op);
- from a task queue worker (a separate process, no pre-existing event loop);
- from a unit test (sync context, fixture injection).

Sources of non-determinism (system clock, random, locale) are further constrained by Invariant 8 for `output_hash`-idempotent plugins.

**Contract test (mandatory):** the plugin runs in three hosts — `in_process_host`, `forked_process_host`, `fresh_event_loop_host` — with identical input. Results MUST compare equal.

### 2. Serializable boundaries

Anything that crosses a plugin boundary MUST be **JSON-serializable**. Boundaries:

- hook input;
- hook output;
- checkpoint (state for resume);
- progress event.

**Forbidden:** live HTTP/DB clients, session objects, connection pools, open file handles, native library handles (C extensions), async generators / coroutines / threads / channels, closures, bound methods, any non-serializable callables, native arrays with non-contiguous memory layout.

**Allowed:** structured data validatable through JSON Schema (Python pydantic / TS zod / Go struct + tag), primitives, arrays / maps of those, bytes (up to the DST-0001 §File uploads limit — ≤10MB MVP), references to external resources (`s3://`, `file://`, `vector_store://collection`) — but not the resources themselves.

**Constraint for chain hooks (consistent with DST-0002):** chain plugins MUST NOT be `in_process_only` (`mcp_exposed: false`). The boundary between chain stages is a serialization point even in the in-process runtime: output[N] → input[N+1] MUST be round-trip JSON-serializable.

**Contract test (mandatory for every non-`in_process_only` plugin):**
- Round-trip JSON serialize / deserialize → reconstruct → deep-equal against the original for every hook input/output.
- Explicit checks for types that silently break JSON: datetime (ISO 8601), Decimal/BigInt (string), set (→ array), Enum (→ value), UUID (→ string).
- For chain plugins — symmetry check: stage N+1 input schema covers stage N output schema.

**Exception:** `in_process_only` plugins MAY pass live objects within a single hook invocation (for example, a stream from a streaming-capable plugin to SSE on the client). However, **checkpoint and progress remain serializable** — otherwise resume after a restart is impossible.

### 3. Resources via dependency injection

A plugin MUST NOT create long-lived resources internally. HTTP clients, DB clients, connection pools, native parser pools, blob store clients — all of these MUST be **injected** by the host through `PluginContext.resources`.

**Standard resources (Phase 0 minimal set), available in `ctx.resources` if declared in the manifest:**

| Resource | Purpose |
|---|---|
| `http_client` | HTTP client preconfigured with the corporate CA bundle / TLS config. The plugin does not deal with TLS itself. |
| `tmpdir` | Temporary directory for intermediate files. Cleaned up on `teardown()`. |
| `blob_store` | Abstract `BlobStore` interface (S3 / FS / etc). |
| `clock` | Injectable clock interface (testable + freezable in tests). |
| `rng` | Injectable random source (testable + reproducible with a seed). |

**Future-optional (Phase 1+):**
- `postgres` — preconfigured connection pool.
- `tracer` — distributed tracer (OpenTelemetry-compatible).
- `rate_limiter` — global rate-limiting service.

**Manifest declaration:**
```toml
[tool.dagstack.plugin.resources]
required = ["http_client", "blob_store"]
optional = ["postgres"]
```

If the contract is not met (the plugin requires `postgres` but the host does not provide it), the plugin is marked `unavailable` with a clear error.

**Contract test:** the plugin runs against alternative resource implementations (memfs blob_store, frozen clock, deterministic rng). The result MUST be bit-equal to a run with production resources for idempotent plugins.

### 4. `execution_model` declared in the manifest

The plugin declares its execution style. The host picks the executor.

**Enum `execution_model`:**

| Value | Semantics | When to use |
|---|---|---|
| `async` | Async-aware (Python async/await, JS async, Go goroutines). The host calls into an event loop / runtime. | I/O-bound (HTTP calls, queries). |
| `sync` | Pure synchronous, non-blocking. | Fast transformations (parse/format). |
| `thread_cpu_bound` | Sync, CPU-bound — goes into a thread pool / worker thread. | Re-ranking, ML inference (small models). |
| `process_cpu_bound` | Sync, heavy CPU — separate process. | ML inference (large models), heavy parsing. |

**Implementation:** the host places the plugin in the matching executor (event loop / thread pool / process pool). The plugin MUST NOT pick its own executor — that responsibility belongs to the host.

**Contract test:** a sync plugin MUST NOT perform blocking I/O (detected through language-specific tooling — Python `blockbuster`, Node `--report-uncaught-exception`); an async plugin MUST NOT perform CPU-bound work without an explicit yield.

### 5. Unit of Work for long-running plugins

Plugins with long-running operations (minutes+) declare a **unit of work** in the manifest:

```toml
[tool.dagstack.plugin.unit_of_work]
declared = true
partition_key = "tenant_id"
estimated_duration_sec = 600
idempotency_mode = "input_hash"   # input_hash | output_hash | none
checkpointable = true
```

**Fields:**
- `partition_key` — sharding key (the orchestrator places units of one partition into a single queue).
- `estimated_duration_sec` — for the scheduler (avoids head-of-line blocking).
- `idempotency_mode` — see Invariant 7.
- `checkpointable` — true if the plugin can resume through `ctx.checkpoint`.

UoW plugins are invoked by the orchestrator (kind `orchestrator`), not directly by the consumer. If no orchestrator is registered, execution falls back to the in-process executor (`LocalExecutorOrchestrator` — a mandatory in-tree plugin).

### 6. Progress / checkpoint sinks

A plugin publishes progress through the abstract `ctx.progress` sink (NOT directly to a WebSocket / SSE / log file).

**ProgressSink interface:**
```
ctx.progress.update(percent: float, message: str, payload: dict | None)
ctx.progress.event(event_type: str, payload: dict)
```

The sink implementation is the host's responsibility:
- consumer in-process: WebSocket broadcast / SSE.
- orchestrator op: stream into orchestrator state.
- unit test: append to a list for assertions.

**CheckpointStore interface:**
```
ctx.checkpoint.save(key: str, state: dict) → version_id
ctx.checkpoint.load(key: str) → (state: dict | None, version_id)
ctx.checkpoint.list(key_prefix: str) → list[(key, version_id)]
```

Implementation:
- Phase 0 in-process: JSON files on disk (`<consumer-dir>/.checkpoint/<key>.json`).
- Phase 1+: Postgres / S3.

**Contract:**
- `save` MUST be atomic (write-then-rename for file-backed stores; transaction for DBs).
- `load` after `save` MUST always return the latest saved state (read-after-write consistency).
- `state` MUST be JSON-serializable (Invariant 2).

**Contract test:** the plugin runs against an alternative CheckpointStore (in-memory dict). Resume after a simulated crash at an arbitrary progress point MUST yield a final result equal to a single-pass run.

### 7. Idempotency modes

A UoW plugin declares `idempotency_mode`:

- **`input_hash`** — a re-run with the same input yields the same output. The hash of the input identifies the result.
- **`output_hash`** — a re-run MAY produce a new output, but if the output hash matches the previous one, it is treated as a single result (downstream optimization).
- **`none`** — every run produces a new result. Each incremental rerun yields a duplicate (the consumer is responsible for deduplication).

The orchestrator uses `idempotency_mode` to skip duplicate runs:
- Before launching a unit, it computes the input hash and checks the registry for a completed run with that hash.
- If one exists, the run is skipped (cache hit) and the saved output is returned.

**Output_hash specifically:** requires the plugin to be deterministic. Sources of non-determinism (system clock, random) MUST be injected through resources (`ctx.clock`, `ctx.rng`) and folded into the input hash. See Invariant 8.

### 8. Determinism for output_hash plugins

A plugin with `idempotency_mode = "output_hash"` MUST be **deterministic** (the same input + the same resource state → the same output).

**Forbidden:**
- Using ambient `time.now()` / `Date.now()` / `time.Now()` — only `ctx.clock.now()`.
- Using ambient `random()` / `Math.random()` / `rand.Int()` — only `ctx.rng.next(...)`.
- Relying on iteration order from unordered collections (Python dict before 3.7, Go map, JS Object without `Map`) — explicit sort is required.
- Relying on locale-dependent behavior (string comparison, number formatting).

**Resource-injected clock and rng** allow:
- Testing with a frozen clock / seeded rng — bit-equal output between runs.
- Production runs: clock = real system clock, rng = OS source — output is correct but not bit-equal between runs (this is fine; output_hash is determined by the structure of the result, not by noise).

**Contract test:** the plugin is run twice with the same frozen clock / seeded rng → output MUST be bit-equal.

## New kind: `orchestrator`

See `kinds/orchestrator/v1.yaml`.

**Singleton, always `in_process_only`.**

There is at most one orchestrator per runtime. It cannot live behind an MCP wire (the orchestrator holds state in host memory: queue, in-flight tracking, retry counters).

**Hooks (kind_api_version 1.0.0):**

- `enqueue(plugin_name, args, idempotency_key?, partition_key?)` → `(unit_id, deduplicated)`. Place a UoW in the queue, idempotent over `idempotency_key`.
- `status(unit_id)` → `(state, started_at?, finished_at?, progress?, error?)`. Current status.
- `backfill(plugin_name?, partition_key?, since?, until?, states?)` → `(enqueued_count, skipped_count)`. Re-enqueue failed/expired units.

### Default in-tree implementation: `LocalExecutorOrchestrator`

**Required in-tree plugin in every core implementation.** Without it, no UoW runs. Semantics:
- in-process executor — `enqueue` → run in the same event loop / thread pool.
- in-memory queue (or persisted JSON in Phase 0).
- Real queues (Postgres-based / Redis-based) — Phase 1+ via external `orchestrator` plugins (Dagster wrapper, Celery wrapper, etc).

## Impact on ADR-0001 (backward-compatible)

This ADR extends the `PluginManifest` schema (ADR-0001 §Manifest) by adding fields:
- `execution_model: enum` (default `"sync"`).
- `in_process_only: bool` (default `false`).
- `resources: { required: list[str], optional: list[str] }` (default `{}`).
- `unit_of_work: { declared: bool, partition_key, estimated_duration_sec, idempotency_mode, checkpointable }` (default `declared=false`).

All fields are **optional with safe defaults** — manifests written before this ADR keep working.

PluginContext (ADR-0001 §PluginContext) is extended with fields:
- `resources: ResourceRegistry | None` (default `None`).
- `progress: ProgressSink | None` (default `None`).
- `checkpoint: CheckpointStore | None` (default `None`).

All fields are **optional** — Phase 0 plugins (with no resources / UoW declarations) see no difference.

## Phase plan

- **Phase 0 — invariants 1-4 fixed in spec.** The manifest schema is extended; `PluginContext` fields are declared as Protocol stubs. Real DI implementations of resources / progress / checkpoint land in Phase 1.
- **Phase 1 — runtime impl.** `Resources` registry, `WebSocketProgressSink` (for consumers with a web UI) / `LogProgressSink` (for CLIs), `FileCheckpointStore` (JSON files in Phase 0), `LocalExecutorOrchestrator` built in.
- **Phase 2 — external orchestrators.** Wrappers for Dagster / Celery / Airflow / k8s Job through the MCP `mcp_stdio` / `mcp_http` runtime. `PostgresCheckpointStore`, `S3BlobStore`, etc.
- **Phase 3 — distributed execution at scale (10⁴+ partitions).** Production-ready compat-matrix with real external orchestrators.

## Consequences

### Positive

- A plugin behaves identically in-process, in a task queue, in an orchestrator op, and in a unit test — no conditional code.
- Resume of long-running UoW after a crash via `ctx.checkpoint` — without rewriting plugin logic.
- Orchestrator integration (Dagster/Celery/Airflow) — added as a plugin without touching existing plugins.
- Unit testing is cheap — alternative resources (frozen clock, in-memory checkpoint store) yield reproducible test runs.

### Negative / risks

- **The discipline tax** — plugin authors MUST honor invariants 1-8. Contract tests catch some violations but not all (for example, ambient time accessed through a third-party library — runtime detection requires tracing). A review culture is required.
- **Phase 0 does not deliver real DI runtime** — Resources / ProgressSink / CheckpointStore are Protocol stubs. Phase 0 plugins effectively cannot rely on them (they raise `NotImplementedError` on access). This is acceptable for Phase 0 (no UoW plugins yet), but it creates a trap: "I declared it in the manifest, tried to use it, got `None`." Defensive warnings in the registry are needed.
- **`output_hash` determinism** — a strict contract that is easy to break by accident (`set()` iteration order, third-party native libs that aren't frozen-clock-aware). The MVP is optimistic; the contract test catches the most obvious breakage.

## Open questions

- **Cross-process checkpoint coordination.** If two orchestrators concurrently process partitions of the same UoW, who wins on a concurrent `save`? CAS / optimistic locking — Phase 1+ ADR.
- **Backpressure protocol.** Today progress is fire-and-forget. If the ProgressSink cannot keep up (slow network, downstream backed up), does the plugin block on send or drop events? Default is drop with a WARN. Whether this needs to be formalized in the spec is pending.
- **Resource lifecycle scoping.** Today every resource is a singleton per host. There may eventually be a need for per-request / per-tenant resources (for example, separate HTTP clients for different corporate endpoints). YAGNI until a real need surfaces.

## Provenance

Pure-spec extracted from `dagstack/plugin-system-python/docs/adr/0003-orchestration-neutral-runtime.md` (v1.0, accepted 2026-04-15). Python-specific binding (httpx as the http_client implementation, pydantic as the boundary type system, asyncio as the execution_model.async target, importlib for resources discovery, contextvar / threading.local detection in contract tests, blockbuster for sync detection) moves to `dagstack/plugin-system-python/docs/adr/0003-binding.md`.

Numbering correspondence:
| dagstack/plugin-system-spec | dagstack/plugin-system-python (binding) | pilot consumer (historical upstream) |
|---|---|---|
| ADR-0003 | python ADR-0003-binding | pilot ADR-0004 v1.3 |

## References

- ADR-0001 — Plugin architecture core (Manifest schema, PluginContext base fields).
- ADR-0002 — Hook invocation semantics (chain constraint, lifecycle ordering).
- ADR-0004 — Hookspec formalism (where `execution_model` is serialized in YAML).
- `kinds/orchestrator/v1.yaml` — hookspec for the orchestrator kind.
- [Dagster ops + assets](https://docs.dagster.io/concepts/ops-jobs-graphs/ops) — reference architecture for an external orchestrator wrapper.
- [Celery tasks + canvas](https://docs.celeryq.dev/en/stable/userguide/canvas.html).
- [k8s Job lifecycle](https://kubernetes.io/docs/concepts/workloads/controllers/job/).
