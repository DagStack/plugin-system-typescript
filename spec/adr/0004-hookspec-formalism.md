# ADR-0004: Hookspec formalism — YAML wrapper + JSON Schema → multi-target emit

- **Status:** accepted v1.0
- **Date:** 2026-04-16
- **Architect review:** ai-systems-architect (single round)
- **Supersedes:** —
- **Related:** DST-0001 (plugin architecture core), DST-0002 (hook invocation semantics)

## Context

dagstack is a multi-language plugin framework. Implementations:
- **Python core** (in development): pluggy + pydantic, manifest = TOML.
- **TypeScript / Node core** (planned): zod + manifest as JSON.
- **Go core** (later).

Every implementation MUST share:
- A single plugin manifest format (`dagstack-plugin.{toml,json}`).
- The same set of `kind`s (taxonomy: `tool`, `orchestrator`, future `vector_store`, `chunker`, `llm`, …).
- The same hook signatures per kind (name, typed arguments, return type).
- The same hook semantics (Singleton / Broadcast-Collect / Broadcast-Notify / Chain / Dispatch-by-capability — pinned in DST-0002).
- A single MCP wire protocol (JSON-RPC 2.0 over stdio/HTTP) for cross-process plugins.

**Problem:** where is the source of truth for all of this? Without a single format, every core ends up with its own hand-typed models — they will diverge within a year.

## Decision

**Source of truth — hybrid:**

1. **Custom YAML wrapper** (thin, ~200 lines of parser) describes kind + hooks + dispatch class + references to JSON Schemas for payloads.
2. **JSON Schema 2020-12** describes payloads (input/output for each hook).
3. **Generated artifacts** (committed to the repo, not built at install time):
   - **Python**: pydantic models + a `Protocol` class with hook-semantic decorators.
   - **TypeScript**: zod schemas + an `interface` + dispatch metadata.
   - **OpenRPC** for the MCP wire (MCP servers read this for tool registration).
   - **Markdown** human-readable docs.
   - **(Go later)** struct + interface via `quicktype`.

CI gate: `make emit && git diff --exit-code`.

### Minimal hookspec YAML format

```yaml
kind: tool
kind_api_version: 1.0.0
description: |
  Function-style plugin: one or more executable hooks; each takes structured
  args and returns a structured result.

hooks:
  - name: get_schema
    dispatch: broadcast_collect
    description: List of JSON schemas (one per plugin hook).
    input_schema: schemas/empty.json
    output_schema: schemas/get_schema.output.json
    mcp_exposed: false

  - name: execute
    dispatch: singleton
    description: Run the tool with arguments.
    input_schema: schemas/execute.input.json
    output_schema: schemas/execute.output.json
    mcp_exposed: true
    mcp_tool_name_template: "{kind}.{plugin}.{hook}"
```

### Pipeline

```
spec/kinds/tool/v1.yaml + schemas/*.json
        │
        ├─► emitters/python_pydantic.py
        │   → dagstack/plugin-system-python/_generated/kinds/tool/v1.py
        │   (pydantic models + Protocol class + dispatch decorators)
        │
        ├─► emitters/typescript_zod.ts
        │   → dagstack/plugin-system-typescript/src/_generated/kinds/tool/v1.ts
        │   (zod schemas + interface + dispatch metadata)
        │
        ├─► emitters/openrpc.py
        │   → docs/openrpc/tool-v1.json
        │   (read by MCP servers for tool registration)
        │
        └─► emitters/markdown.py
            → docs/kinds/tool-v1.md
```

## Alternatives considered

A detailed comparison lives in the architecture review; below is a short summary noting why each option was rejected.

| Alternative | Status | Why not |
|---|---|---|
| **TypeSpec** (Microsoft) | candidate №2 (2027+ once it matures) | Go emitter is not first-class today; community decorators for our Singleton/Broadcast/Chain semantics do not exist. Worth revisiting in 1-2 years. |
| **Pure OpenRPC** | used as an **emit target**, not as the source of truth | Does not understand hook-semantic primitives (Singleton/Broadcast); awkward to version per kind. |
| **Pure OpenAPI 3.1** | rejected | REST-centric; describing "functions" through operations is unnatural. |
| **Protobuf + gRPC** | rejected | Its own wire format breaks MCP JSON compatibility; tooling-heavy. |
| **JSON Schema only** (no wrapper) | rejected as the single source of truth | It describes data, not functions; a hook → list of JSON-RPC methods needs the semantics described elsewhere — which brings us back to a wrapper. |
| **Custom IDL without a JSON Schema base** | rejected | Inventing a payload language from scratch; we lose ready-made validators / generators / IDE tooling. |

## Phase 0 minimum (pinned NOW, hardest to reverse)

1. **Closed enum dispatch_classes** — `singleton | broadcast_collect | broadcast_notify | chain | capability`. Extending the enum requires an ADR.
2. **`kind_api_version` SemVer policy** — a major bump is breaking; plugins MUST update the declaration in their manifest.
3. **MCP tool naming convention** — `{kind}.{plugin}.{hook}` or an alternative (the chosen value is pinned in `_meta/`).
4. **Hook naming convention** in YAML — `snake_case`.
5. **Existing kinds** (`tool`, `orchestrator`) described as v1.0.0.
6. **Working Python emitter** + a TS-emitter stub with one hook — proof that the YAML is not Python-biased.

Deferred (Phase 1+):
- Go emitter (once a Go core exists).
- `mcp_exposed: false` for in-process-only hooks (default is "everything through MCP").
- Capability-based dispatch primitives (DST-0002 §dispatch-by-capability).
- CI tooling for backward-compat schema diffs.

## Lock-in analysis

| Decision | Cost to back out |
|---|---|
| JSON Schema as the payload contract | Cheap — it is the lingua franca and converts to almost anything. |
| Custom YAML wrapper | Cheap — ~200 lines of parser; migrating to TypeSpec is mechanical. |
| OpenRPC as an emit target | Free (re-emit). |
| **Hook naming + kind_api versioning scheme** | **Expensive** — this binds ALL existing plugins. **That is why it is pinned in Phase 0.** |
| (If we adopted) TypeSpec now | Expensive — tied to MS roadmap. |
| (If we adopted) Protobuf | Very expensive — wire format changes, all clients break. |

## Consequences

### Positive

- **A single source of truth** for contracts across 3+ languages.
- **Generated files committed** → consumers see them in diffs and do not depend on a build pipeline.
- **MCP autoport** — OpenRPC automatically registers every `mcp_exposed: true` hook without a hand-maintained list.
- **Documentation generation is free** — markdown emit comes from the same YAML.
- **Migration path** to TypeSpec / another IDL stays open (mechanical YAML rewrite).

### Negative

- **Custom format** requires maintaining a parser (~200 lines) and emitters (~150-300 lines each).
- **Phase 0 defers** Phase 1 in the Python core (hook classes, topo-sort lifecycle) by 1-2 iterations.
- **Generated files in the repo** = more commit noise on changes. Mitigation: the `git diff --exit-code` CI gate guarantees sync, plus auto-PRs for regeneration.

### Neutral

- One round of architecture review is complete; design stability is expected to last 12-18 months. After Phase 1 a second round is plausible if the dispatch_classes enum proves limiting.

## Implementation plan

(Treat as the roadmap for the current iteration, not as part of the ADR contract.)

1. Phase 0 spec content — `_meta/dispatch_classes.yaml`, `_meta/versioning.md`, `_meta/manifest.schema.json`, `kinds/tool/v1.yaml` + schemas, `kinds/orchestrator/v1.yaml` + schemas, `naming/{python,nodejs,golang}.md`.
2. `emitters/python_pydantic.py` (~150-300 LOC) + first regenerate into `dagstack/plugin-system-python/_generated/`.
3. `emitters/typescript_zod.ts` minimal (a single hook validates the design).
4. `emitters/openrpc.py`, `emitters/markdown.py` — stubs (Phase 1 implements them fully).
5. CI: `make emit && git diff --exit-code`.

## Provenance

The decision was made after a single-round architecture review delegated to the `ai-systems-architect` agent. Context and rationale are preserved in the session log.

## References

- DST-0001 §plugin-architecture — overall structure.
- DST-0002 §hook-invocation-semantics — where dispatch classes live.
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/release-notes.html).
- [OpenRPC](https://open-rpc.org/) — emit target for the MCP wire.
- [PEP 420 implicit namespace packages](https://peps.python.org/pep-0420/) — for cross-distribution Python imports under `dagstack.plugins.*`.
