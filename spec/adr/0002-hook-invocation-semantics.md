# ADR-0002: Hook invocation semantics (language-agnostic)

- **Status:** accepted (v1.0, 2026-04-16)
- **Date:** 2026-04-16
- **Supersedes:** dagstack/plugin-system-python/docs/adr/0002 (Python/pluggy-centric version) → moves to `python-binding addendum`.
- **Related:**
  - ADR-0001 — Plugin architecture core.
  - ADR-0003 — Orchestration-neutral runtime (lifecycle).
  - ADR-0004 — Hookspec formalism (the `dispatch` field in YAML).
  - `_meta/dispatch_classes.yaml` — closed enum.

> **What this is:** language-agnostic semantics for hook invocation. Concrete bindings (pluggy in Python, EventEmitter in Node, channels in Go) live in `dagstack/<lang>/docs/adr/`.

---

## Context

Any hook dispatcher provides basic LIFO semantics — «call every hookimpl, collect the results into a list». For real consumer scenarios that is not enough:

- backend connector kinds need exactly **one active** plugin per kind, not all of them;
- tool integration kinds need the **complete list** of implementations, and a failure of any one breaks downstream consumers;
- domain event notifications need a **fire-and-forget broadcast**, where a single failure breaks nothing;
- middleware processors need a **sequential chain** in which output[N] becomes input[N+1];
- format-specific handlers need **dispatch by input type**, with exactly one handler per request.

This ADR fixes the five dispatch classes and the order of lifecycle calls that every dagstack core implementation MUST honor.

## The five dispatch classes

The full closed enum lives in `_meta/dispatch_classes.yaml`.

### 1. `singleton`

A single active plugin per kind (or per `(kind, name)` pair). The active-plugin selection algorithm:

1. If the consumer has an active **explicit routing policy** for the kind (per-tenant group, blue/green split), it is used;
2. Otherwise — a global config override (an environment variable of the form `DAGSTACK_ACTIVE_<KIND>=<plugin_name>`);
3. Otherwise — registered candidates are sorted by `priority desc`; the highest wins;
4. With equal `priority` — `AmbiguousPlugin` error, the core does not start.

**Return value:** the first non-empty result. If every plugin returned empty/error — `KindUnknown` or `NoCapableHandler`.

**Use cases:** backend connector, domain orchestrator (one per runtime), any kind with «one active per name».

### 2. `broadcast_collect`

Every active plugin is called and the results are collected into a **list** in `priority desc` order, with ties broken by name. Use cases: tool catalogs, metric exporters, capability providers.

**Error policy:** **fail-fast by default** — a failing plugin breaks the collect, the core returns an error to the caller and marks the plugin `degraded`. A kind MAY override this to `best_effort` through the kind hookspec metadata (a plugin failure is skipped and a partial result is returned).

### 3. `broadcast_notify`

Fire-and-forget. Every active plugin is called in parallel. Results are NOT collected. A failure of an individual plugin is logged (`plugin=X error=...`) and does not propagate to the caller. Use cases: lifecycle events (`on_started`, `on_request`, `on_error`).

**Return value:** void/None.

### 4. `chain`

Output[N] becomes input[N+1]. Strict linear order by `priority desc`. Use cases: middleware (request rewriting, post-processing, re-ranking).

**Short-circuiting:** an explicit return of a kind-specific sentinel value or a thrown error — subsequent plugins are not called.

**Constraint:** chain hooks MUST be **RPC-safe** (mcp_exposed). Streams and complex cyclic objects are not supported in a chain — a contract test verifies this.

### 5. `capability` (Dispatch-by-capability)

Several plugins of the same kind, each handling some subset of the input. A request is routed to exactly **one** matching plugin (unlike `singleton`, where one plugin owns the whole kind, and unlike `broadcast_*`, where every plugin is called).

#### Capability declaration in the manifest

```toml
[tool.dagstack.plugin]
kind = "file_processor"
name = "format-a-handler"
supports_languages = ["format-a"]
supports_extensions = [".fmta"]
# optional for non-file inputs:
supports_mime_types = ["application/x-format-a"]
priority = 60
fallback = false       # exactly one fallback per kind
```

#### Selection algorithm

```
dispatch(kind, input) → plugin
  1. candidates = every registered plugin of the kind whose
     capability matches the input (extension / language / mime_type / ...).
  2. If candidates is empty → the plugin with fallback=true; if there is none → DispatchError.
  3. If candidates > 1 → sort by priority desc, breaking ties by name.
  4. Return the first one.
```

The algorithm runs in the Registry, not in plugins. The plugin author only **declares the capability in the manifest**; the core maintains a `capability → plugins` index for O(1) lookup.

#### Fallback semantics

Exactly **one** plugin per kind MAY declare `fallback = true`:
- it fires when no capability matches;
- two fallbacks for one kind → `AmbiguousPlugin` at startup, the core does not start;
- with no fallback and a non-matching input → `DispatchError`. The core returns the equivalent of HTTP 422 to the client.

**Requirement on the fallback plugin:** it MUST NOT raise on any valid input of its kind. Every edge case (empty input, malformed UTF-8, binary data, large input, permission denied, ...) is handled gracefully (`[]` or a skip signal). Otherwise a non-matching input breaks the request chain.

#### Contract test for the fallback

A mandatory part of the base contract:
- a curated dataset of edge-case inputs (binary, empty, malformed UTF-8, permission-denied, >10 MB, ...);
- each one is run through the fallback — **none** MAY produce an unhandled exception;
- every call returns a well-formed POJO.

### Singleton vs Capability comparison

| | Singleton | Capability |
|---|---|---|
| What the plugin knows | the entire kind (every input) | only some inputs (capability) |
| Active selection | one per kind | different ones for different inputs |
| New implementation | replaces the entire kind logic | is added without conflict |
| Typical kind | backend connector, domain orchestrator | file processor, format-specific handler |

## Recommendations for choosing a dispatch class for a new kind

| Situation | Class |
|---|---|
| One active «backend» of a kind | `singleton` |
| Collect a list/catalog from everyone (tools, metrics) | `broadcast_collect` |
| An event with N subscribed handlers | `broadcast_notify` |
| Middleware with a transformation | `chain` |
| Implementations specialize by input type (ext/lang/mime) | `capability` |

## Lifecycle ordering

Lifecycle methods (`setup`, `teardown`, `health`) are invoked **directly** on plugin instances, not through the hook dispatcher. They have their own ordering rules.

### Startup order

1. By runtime: `in_process` → `mcp_stdio` → `mcp_http` (fast and reliable first; networked last so that their timeouts do not block the others).
2. Within a runtime — **topological sort** by the manifest's `depends_on` field.
3. With equal dependencies — `priority desc`, then by name.
4. Inside one topological group — in parallel with a per-plugin `startup_timeout` (default 30 s).

### Partial failure inside a topo group (continue-on-failure)

- A plugin whose `setup` fails or exceeds the timeout is marked `unavailable` with a reason.
- Every plugin whose `depends_on` contains the failed one is **recursively** marked `unavailable`.
- The other groups continue startup.
- The core starts in degraded mode; the `unavailable` list is visible through the `/api/plugins` equivalent.
- Rationale: failing the entire group on a single failure is unstable in distributed scenarios (especially for `mcp_http`); continue-on-failure is the pragmatic choice for production.

### Shutdown order

- Strictly the reverse of startup (a plugin that others depend on shuts down last).
- Per-plugin `teardown_timeout` (default 15 s).
- **If teardown does not fit within the timeout:**
  - the operation is cancelled (cancellation in Python/JS, `context.Done` in Go);
  - the plugin is marked `leaked`;
  - the next ones in the queue continue with teardown (we do not block core shutdown forever);
  - for the `mcp_*` runtime — force-kill the subprocess (SIGTERM → 5 s → SIGKILL) or drop the HTTP connections;
  - `leaked` plugins block process-level hot reload until the core is restarted.

### Health check

In parallel, independently, periodic with a per-plugin interval (default 30 s). A failure marks the plugin as degraded with periodic retry. Multiple consecutive failures → `unavailable` plus an alert.

## Manifest additions (relative to ADR-0001)

```toml
[tool.dagstack.plugin]
# ... base fields ...

priority = 50                                 # 0-100, default 0. Higher = earlier / more important.
depends_on = ["plugin-a", "plugin-b"]         # plugin names
tryfirst = false                              # forced to run first (debug / override)
trylast = false                               # forced to run last (cleanup)
startup_timeout_sec = 30                      # timeout for setup()
teardown_timeout_sec = 15                     # timeout for teardown()

# Capability dispatch (when a kind uses dispatch_class=capability):
supports_languages = []
supports_extensions = []
supports_mime_types = []
fallback = false
```

`tryfirst` / `trylast` are escape hatches for debugging or override; they MUST NOT replace priority+depends_on in production. Using both → `model_post_init` error.

## Relationship between `priority` and consumer routing policies

These are two **distinct selection axes**:

- **`priority` in the manifest** — used for:
  - lifecycle ordering (startup/shutdown/broadcast order);
  - tiebreaking in `singleton` and `capability` when **neither** an explicit config override **nor** a consumer routing policy is applicable.

- **Consumer routing policies** (per-tenant groups, blue/green, canary) — they **override** `priority` in the runtime selection for `singleton` / `capability` when the relevant context is active.

If a consumer routing policy is active for a kind, the manifest `priority` **does not participate** in runtime selection.

## Conflict resolution

| Conflict | Resolution |
|---|---|
| `singleton` ambiguity (equal `priority`, no config override, no consumer routing) | `AmbiguousPlugin: equal priority for kind=X, set DAGSTACK_ACTIVE_X to disambiguate`. The core does not start. |
| Dependency cycle (`A → B → A`) | `DependencyCycle`. The core does not start. |
| `depends_on` references a missing plugin | The dependent plugin is marked `unavailable` with a clear reason; the rest of the system keeps working. |
| Two `fallback = true` plugins per kind | `AmbiguousPlugin`. The core does not start. |

## What is **not** guaranteed

- Ordering between different topics on the event bus (ADR-0001 §EventBus).
- Stateless behavior of `broadcast_*` — calls run in parallel, the plugin is responsible for concurrency safety if it keeps state.
- A global ordering across different kinds (only within one kind).

## Capability dispatch: implementation path

**Initial path** (a single implementation of the kind): one implementation with internal routing — registered as `singleton`. This works as long as no alternative implementations exist.

**Next iteration** (alternative implementations appear):
- the Registry builds a capability index at startup (reading `supports_*` from the manifests);
- a `registry.dispatch(kind, input)` method appears;
- the existing aggregated plugin declares all of its capabilities explicitly (`supports_languages = [...]`);
- a built-in fallback plugin with `fallback = true`;
- new specialized plugins are added without modifying the Registry or any existing plugin.

**Backward compat:** `singleton` plugins without `supports_*` fields are treated as «match anything». When the kind transitions to `capability` they become the default fallback.

## Open questions

- **Per-context dispatch routing.** Consumer routing policies currently focus on `singleton` (a group = one selected plugin). For `capability` the group MUST define a **set** of candidates (a subset of the plugins registered for the kind), inside which dispatch operates as usual. To be formalized once the second specialized plugin appears in some capability kind.
- **Multi-match strategies.** Currently, on multiple capability matches, exactly one plugin is selected (by priority). At some point the need may arise to run **several** plugins in parallel and merge the results — that is no longer `capability` but `broadcast_collect_filtered` (does not exist; carve out a separate dispatch class once a use case appears).
- **Capability as an expression.** Currently `supports_*` are flat lists. The need may arise for a condition (`supports_when = "file.size > 10MB"`). YAGNI until there is a real demand.

## Provenance

Pure-spec version extracted from `dagstack/plugin-system-python/docs/adr/0002-hook-invocation-semantics.md` (v1.0, accepted 2026-04-15). Python-specific binding (pluggy decorator markers `firstresult=True/False`, `@hookspec(error_policy=...)`, `@notify`, `@in_process_only`, `asyncio.gather` for parallel setup/teardown, `asyncio.CancelledError` for timeout cancellation) moves to `dagstack/plugin-system-python/docs/adr/0002-binding.md`.

Numbering correspondence:
| dagstack/plugin-system-spec | dagstack/plugin-system-python (binding) | Pilot consumer (historical upstream) |
|---|---|---|
| ADR-0002 | python ADR-0002-binding | pilot ADR-0003 v2.1 |

## References

- ADR-0001 — Plugin architecture core.
- ADR-0003 — Orchestration-neutral runtime (lifecycle invariants).
- ADR-0004 — Hookspec formalism (how the `dispatch_class` field is serialized in YAML).
- `_meta/dispatch_classes.yaml` — closed enum.
