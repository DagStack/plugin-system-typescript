# ADR-0005: Extensibility hooks for horizontal concerns (governance / quota / observability)

- **Status:** accepted v1.0 (2026-04-16)
- **Scope:** language-agnostic spec — the plugin-system's promise of
  extensibility to future products in the dagstack ecosystem.
- **Related:**
  - ADR-0001 — PluginContext, lifecycle.
  - ADR-0002 — chain dispatch class.
  - ADR-0003 — Resources DI, trace context invariant.

## Context

dagstack is an **umbrella brand** for AI/ML infrastructure (see
[`dagstack/spec`](https://github.com/dagstack/spec)). Plugin-system is the
**bottom layer**. Higher-level products are planned on top:

- **governance / iam** — permissions per (tenant, plugin, action), audit logs.
- **quota / metering** — accounting for consumption (LLM tokens, vector DB
  writes, storage bytes) per tenant, plus enforcement.
- **observability** — uniform traces / metrics / structured logs across all
  plugins and orchestrators.
- **tenancy** — multi-tenant scoping of resources (org → team → project).

These products live in **separate repos** (`<product>-spec` + impl) but plug
into plugin-system as **middleware plugins** or **Resource decorators**. So
that a governance plugin can inject `tenant_id` and check permissions before
each hook invocation, the plugin-system spec MUST pin down the **extension
points** in advance.

**Problem solved:** if plugin-system core knows nothing about tenant / actor /
quota, adding them later becomes a breaking change for every hookspec
(tenant context would need to be threaded through as an argument). This ADR
fixes **what plugin-system guarantees** to the higher-level products so they
can plug in **without modifying plugin-system core**.

**Out of scope:** the tenancy / iam / quota models themselves — those are
separate products with their own specs. This ADR covers only the
**extensibility surface** of plugin-system.

## Decision

The plugin-system spec **guarantees** five extension points. Any product in
the ecosystem (governance, quota, observability, ...) MUST plug in
exclusively through them — without touching plugin-system core.

### 1. `PluginContext.metadata` — open extensibility slot

`PluginContext` (ADR-0001 §PluginContext) MUST contain the field:

| Field | Type | Semantics |
|---|---|---|
| `metadata` | `Mapping[str, Any]` (immutable view) | Open key-value slot for horizontal concerns. Plugin-system core does NOT interpret keys; middleware reads and writes them. |

**Canonical keys (reserved for horizontal products):**

| Key | Writer | Reader | Purpose |
|---|---|---|---|
| `tenant_id` | governance middleware | I/O plugins, Resources | Tenant scope of the current invocation |
| `actor` | iam middleware | governance middleware, audit | Subject identity (user / service) |
| `quota_budget` | quota middleware | I/O plugins (optional) | Remaining budget per (tenant, resource_type) |
| `trace_context` | observability middleware | I/O plugins, Resources | W3C Trace Context (`traceparent` + `tracestate`) |
| `request_id` | host runtime | everyone | Correlation in logs |

The list is **open**; new keys are added through an ADR in the spec of the
relevant horizontal product (not in plugin-system).

**Constraint:** `metadata` MUST be serializable (so it can be propagated
across runtimes through `mcp_stdio` / `mcp_http` adapters). Do not stash
complex objects with methods or references to host state.

**Plugin contract:** the plugin author MUST NOT rely on the presence of any
specific key. If a key is missing, the plugin runs without that feature — it
does not crash.

### 2. Chain dispatch — canonical middleware paradigm

ADR-0002 §4 already pins down the `chain` dispatch class: output[N] becomes
input[N+1], strict order by `priority desc`. This ADR explicitly **canonizes
chain as the primary mechanism for horizontal middleware**.

**Pattern "governance as chain middleware":**

```
hookspec: tool.execute (singleton)
  ↓
governance plugin (chain, priority=1000):
  - reads ctx.metadata["tenant_id"], ctx.metadata["actor"]
  - checks permission(actor, tool=name, action="execute")
  - if deny → throw PermissionDenied (chain aborts)
  - if ok → forwards input unchanged
  ↓
quota plugin (chain, priority=500):
  - checks ctx.metadata["quota_budget"][tool.kind]
  - if 0 → throw QuotaExceeded
  - forwards input downstream
  ↓
target tool plugin (singleton, priority=0):
  - performs execute
  ↓
quota plugin post-hook:
  - increments usage based on the result
  ↓
governance plugin post-hook:
  - writes the audit log
```

**Constraints (already in ADR-0002):**
- chain hooks MUST be RPC-safe (`mcp_exposed`).
- Aborting — explicit return sentinel or throw.

**Additions in this ADR:**
- Plugin-system core MUST support chain wrapping for **any** dispatch class,
  not only for kinds that explicitly declare a `chain` hookspec. That is, a
  governance plugin MAY plug into **every hook** through the priority-based
  chain layer that the core applies automatically.
- The priority range `[1000, ∞)` is reserved for horizontal middleware. A
  plugin author MUST NOT use this range for business plugins.

### 3. Resource decoration

ADR-0003 §3 pins down Resources DI: HTTP clients, DB clients, blob stores
are injected by the host through `PluginContext.resources`. This ADR adds an
**invariant**:

> Resources MUST support **decoration** through wrapping: the host runtime
> OR a middleware plugin MAY return a proxy object that implements the same
> interface, delegates calls to the original, and adds cross-cutting logic
> (metering, rate limiting, audit).

**Pattern "quota as a Resource decorator":**

```
manifest: tool requires resources = ["llm_client", "vector_store"]
  ↓
the host runtime assembles Resources:
  llm_client = OriginalLLMClient(...)
  vector_store = OriginalVectorStore(...)
  ↓
the quota middleware asks the registry for decorators at resolve time:
  llm_client = QuotaTracker(llm_client, budget=ctx.metadata["quota_budget"]["tokens"])
  vector_store = QuotaTracker(vector_store, budget=ctx.metadata["quota_budget"]["vector_writes"])
  ↓
the plugin calls llm_client.chat(...) — QuotaTracker increments the counter
before forwarding the call to OriginalLLMClient.
```

**Constraint:** the Resource interface MUST be formally specified (Protocol
/ Interface / TypeScript interface), otherwise decoration breaks type
safety. Every kind that declares resources MUST publish their interface in
the spec.

### 4. Capability-based dispatch — content-aware routing

ADR-0002 §5 already pins down `capability` dispatch: a request is routed to
**a single** plugin whose capability declaration matches.

This ADR adds the use case **"governance-driven filtering"**:

> The host runtime MAY restrict the set of allowed plugins for a given
> invocation based on `ctx.metadata["tenant_id"]` (or another governance
> key). Plugin capability declarations + governance policy → a result set
> from which capability dispatch picks the final executor.

**Pattern "PII-safe routing":**

```
manifest: tool has capability = ["pii_handling"]  # explicitly declared
governance policy:
  tenant=X allowed_plugins where capability ⊇ {"pii_handling"}
  ↓
host filters Registry → candidates
  ↓
capability dispatch picks from the filtered set by input matcher
```

Plugin-system core does NOT implement filtering itself — it only **publishes
capability declarations** and **accepts a filter callback** from the host.
The governance product registers the filter through chain middleware (see §2).

### 5. Trace context propagation

ADR-0003 invariant 8 already requires propagation of W3C Trace Context. This
ADR **makes it concrete**:

- Trace context lives in `ctx.metadata["trace_context"]` (format — W3C
  `traceparent` + `tracestate` strings, MUST be serializable).
- Adapters (`mcp_stdio`, `mcp_http`) MUST propagate `trace_context` across
  the protocol boundary (HTTP headers / JSON-RPC params).
- Resources MUST accept `trace_context` through decoration (see §3) — the
  observability middleware wraps them and emits spans.
- The plugin author MUST NOT call the tracer directly — observability
  middleware automatically emits spans around every hook invocation and
  every Resource call.

## What is explicitly NOT in this ADR

- Tenancy structures (org → team → project) — a separate product.
- The IAM permission model (RBAC / ABAC / ReBAC) — a separate product.
- The quota model (counters / leaky bucket / token bucket) — a separate product.
- Observability backends (Prometheus / OTLP / Jaeger) — a separate product.
- The audit log schema — a separate product.

The plugin-system spec **promises only the surface area** (extension
points), not concrete models. This lets horizontal products evolve
independently.

## Backwards compatibility

All five extension points are **additive**:

- §1 `metadata` — a new optional field on `PluginContext`. Existing plugins ignore it.
- §2 chain wrapping — extends the existing dispatch class. Without middleware nothing changes.
- §3 Resource decoration — an invariant over the already-existing DI mechanism.
- §4 capability filtering — an additive callback in the registry.
- §5 trace context — a concretization of the existing invariant 8.

Bumping `kind_api_version` is NOT required. Bumping `spec_schema_version`:
minor (1.0 → 1.1) due to the addition of the `metadata` field in the
`PluginContext` schema.

## Consequences

**Positive:**
- governance / quota / observability products can be developed **in
  parallel** with plugin-system, without blocking each other.
- Plugin authors write code unaware of tenancy / quota — their plugins
  automatically work in a multi-tenant environment as soon as governance
  middleware is wired in.
- Cross-product integration through a **shared `metadata` key contract** —
  governance writes `tenant_id`, quota reads it; observability reads
  `trace_context`, everyone writes it.

**Negative:**
- `PluginContext.metadata` — an open dict, value type `Any`. Type safety is
  provided by each horizontal product's spec (which declares canonical keys
  and their types), not by plugin-system itself.
- The priority range `[1000, ∞)` for middleware — a convention, not enforced.
  If a plugin author accidentally uses `priority=2000`, they get preference
  over governance. Mitigation: a contract test in plugin-system verifies
  that business plugins have `priority < 1000`.

**Neutral:**
- All five extension points formalize a surface area that already exists in
  ADR-0001/0002/0003. The added implementation load on plugin-system core is
  minimal (add the `metadata` slot).

## Provenance

| spec | binding |
|---|---|
| ADR-0005 | future: per-product specs (governance-spec/adr/0001, quota-spec/adr/0001) |

Architectural input: a discussion with the user on 2026-04-16 — fixing the
dagstack umbrella model and the list of planned horizontal products.

## References

- ADR-0001 — Plugin architecture core (PluginContext, lifecycle).
- ADR-0002 — Hook invocation semantics (chain dispatch class, capability dispatch).
- ADR-0003 — Orchestration-neutral runtime (Resources DI, invariant 8 trace context).
- W3C Trace Context — https://www.w3.org/TR/trace-context/
