# ADR — dagstack/plugin-system-spec

Architectural Decision Records for the language-agnostic plugin-system specification.

> **ADRs here are pure spec.** Binding-level details (how Python loads through `importlib`, how Node loads through `require`) live in `<lang>-repo/docs/`. If a decision mentions «pluggy», «pydantic», or «zod», it is either misformulated or belongs in another directory.

## Index

| ID | Title | Status | Provenance |
|---|---|---|---|
| [0001](0001-plugin-architecture-core.md) | Plugin architecture core | **accepted** v1.0 (2026-04-16) | extracted from dagstack/plugin-system-python ADR-0001 (Python-centric → pure spec) |
| [0002](0002-hook-invocation-semantics.md) | Hook invocation semantics | **accepted** v1.0 (2026-04-16) | extracted from dagstack/plugin-system-python ADR-0002 (pluggy-specific → 5-element dispatch class enum) |
| [0003](0003-orchestration-neutral-runtime.md) | Orchestration-neutral runtime | **accepted** v1.0 (2026-04-16) | extracted from dagstack/plugin-system-python ADR-0003 (8 invariants + orchestrator kind) |
| [0004](0004-hookspec-formalism.md) | Hookspec formalism: YAML + JSON Schema → emit-targets | **accepted** v1.0 (2026-04-16) | architectural review |
| [0005](0005-extensibility-hooks-for-horizontal-concerns.md) | Extensibility hooks (governance / quota / observability) | **accepted** v1.0 (2026-04-16) | preparation for the umbrella ecosystem (governance/quota/iam as chain-middleware) |

## Workflow

1. Any breaking change to the spec (manifest schema, kind/hook semantics, dispatch behavior, naming convention) MUST go through an ADR.
2. An ADR with status `proposed` is discussed in a PR. After acceptance it becomes `accepted`. Older versions are not deleted — `superseded` records link forward to the new ADR.
3. Per-kind contracts (`kinds/<kind>/v<N>.yaml`) are versioned independently via SemVer. A major bump (v2) introduces a new `kind_api_version`; plugins declared as `v1` continue to work through a legacy compat-shim in core.

## History: DST-0001..0003 → spec rework (completed 2026-04-16)

The earlier DST-0001/2/3 in `dagstack/plugin-system-python/docs/adr/` were extracted from a pilot binding's ADRs back when dagstack was not yet positioned as multi-language. They contained pluggy / pydantic / importlib / entry_points — Python-specific details.

**Rework completed in this repo:**
- ADR-0001 — pure spec (854 → 294 lines), no pluggy/importlib/asyncio/pydantic.
- ADR-0002 — pure spec (409 → 247 lines), 5-element dispatch class enum (`singleton` / `broadcast_collect` / `broadcast_notify` / `chain` / `capability`) — language-neutral.
- ADR-0003 — pure spec (928 → 286 lines), 8 invariants + orchestrator kind, no httpx/asyncio/pydantic examples.

Python-specific binding material (pluggy, pydantic, importlib, asyncio APIs) will move into `dagstack/plugin-system-python/docs/adr/000X-binding.md` in a separate PR. For now the older ADRs in `dagstack/plugin-system-python` remain in place with a note: «superseded by dagstack/plugin-system-spec/adr/000X (pure spec) + 000X-binding.md (Python addendum, TODO)».
