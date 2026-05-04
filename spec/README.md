# dagstack/plugin-system-spec

**Language-agnostic source of truth** for the plugin-system — the foundational
layer of the dagstack ecosystem.

> dagstack is an **umbrella brand** for a family of AI/ML tools. The plugin-system
> is one of the products (the foundational layer). Each product has its own
> `<product>-spec` repo: `plugin-system-spec`, `spec-governance`, and so on.

What lives here:
- Plugin manifest schema (JSON Schema 2020-12).
- Kind taxonomy (`tool`, `orchestrator`, … extensible).
- Hook semantics (Singleton / Broadcast-Collect / Broadcast-Notify / Chain / Capability dispatch).
- MCP protocol mapping (how kinds and hooks map to JSON-RPC over stdio/HTTP).
- Lifecycle and runtime invariants.
- Naming conventions for PyPI / npm / Go modules.
- Contract test scenarios (what every core implementation MUST pass).

Language bindings live in **separate repositories**:

| Language | Repo | Distributable |
|---|---|---|
| Python | [`dagstack/plugin-system-python`](https://github.com/dagstack/plugin-system-python) | `dagstack-plugin-system` (PyPI), import `dagstack.plugin_system` |
| TypeScript / Node | [`dagstack/plugin-system-typescript`](https://github.com/dagstack/plugin-system-typescript) | `@dagstack/plugin-system` (npm) |
| Go | (later) | `go.dagstack.dev/plugin-system` via vanity import |

## Why a separate spec repo

1. **Spec comes first, implementations follow.** The contract is fixed before Python/TS/Go implementations diverge. Otherwise a year later you end up with N incompatible interpretations.
2. **One YAML → emitted into every language** through emitters committed to the repo (Python pydantic models + TS zod + OpenRPC for MCP). Nobody hand-writes types for the manifest or hookspecs in cores — only generated code.
3. **ADRs are language-neutral.** ADR-0001/0002/0003 (extracted from an early-adopter binding's ADRs in April 2026) were originally Python-centric (mentioning pluggy, importlib). After the rework there are two layers: `plugin-system-spec/adr/` (pure spec) + `<lang>/docs/` (binding addenda).

## Structure

```
plugin-system-spec/
├── adr/                   # ADRs — pure language-agnostic
│   ├── README.md          # index
│   ├── 0001-...           # extracted: plugin architecture core
│   ├── 0002-...           # extracted: hook invocation semantics
│   ├── 0003-...           # extracted: orchestration-neutral runtime
│   └── 0004-hookspec-formalism.md   # ← fixes the choice YAML+JSON Schema → emit
├── _meta/
│   ├── manifest.schema.json    # JSON Schema for manifest v1
│   ├── dispatch_classes.yaml   # closed enum: singleton|broadcast_collect|...
│   └── versioning.md           # SemVer policy for core, kind_api, schema
├── kinds/
│   ├── README.md               # kind taxonomy index
│   ├── tool/v1.yaml            # kind hook spec (YAML wrapper over JSON Schema)
│   │   └── schemas/*.json      # input/output payload schemas
│   └── orchestrator/v1.yaml
├── naming/
│   ├── README.md
│   ├── python.md               # PyPI flat + PEP 420 namespace `dagstack.plugins.*`
│   ├── nodejs.md               # npm scope `@dagstack/*`
│   └── golang.md               # vanity import `go.dagstack.dev/*`
├── emitters/                   # source-of-truth → language types
│   ├── python_pydantic.py      # → plugin-system-python:_generated/
│   ├── typescript_zod.ts       # → plugin-system-typescript:_generated/
│   ├── openrpc.py              # → docs/openrpc/<kind>-v1.json
│   └── markdown.py             # → docs/kinds/<kind>-v1.md
├── docs/                       # generated emit output
│   ├── kinds/                  # human-readable docs per kind
│   └── openrpc/                # OpenRPC documents (consumed by MCP servers)
└── examples/
    └── echo/                   # reference plugin manifest
```

## Quickstart

```bash
# Pull generated Python types from the spec into plugin-system-python:
git submodule add https://github.com/dagstack/plugin-system-spec.git spec
make emit                 # runs emitters/python_pydantic.py
git diff -- _generated/   # MUST be empty (CI gate)
```

## Versioning

- **`spec_schema_version`** — version of the spec structure itself (manifest.schema.json and friends).
- **`kind_api_version`** — per-kind SemVer, independent. `tool` v1 → v2 means a breaking change in hook signatures and requires plugins to declare a new `kind_api_version` in the manifest.
- **`core_version`** — version of a specific implementation (Python `dagstack-plugin-system==0.x.y`, TS `@dagstack/plugin-system@0.x.y`). Each implementation declares which spec versions it supports.

The compatibility matrix lives in `_meta/versioning.md`.

## Contributing

Changes to a kind, hook, or dispatch class go through the ADR process. Changes to the manifest or to a hookspec that arrive without an ADR are not accepted.

Emitters can be changed without an ADR, but the result in `docs/openrpc/` and downstream `_generated/` MUST rebuild bit-for-bit identically.

See [`adr/README.md`](adr/README.md) for the index of accepted decisions.
