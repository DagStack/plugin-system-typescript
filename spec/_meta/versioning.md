# Versioning policy (plugin-system)

The plugin-system has **three independent version axes**, each with its own SemVer:

## 1. `spec_schema_version`

The version of the spec structure (`manifest.schema.json` format, kind YAML format, the contents of `dispatch_classes`, and so on).

- **Major bump** — incompatible changes in the format itself (for example, `kinds/<kind>/v<N>.yaml` gains a new required field).
- **Minor bump** — addition of optional fields.
- **Patch bump** — clarifications in docs/comments without semantic changes.

Current version: `1.0.0`. Declared in `_meta/manifest.schema.json` under `$id`.

## 2. `kind_api_version`

SemVer **per kind**, independent of the spec and the cores.

- Set in the hook YAML: `kinds/<kind>/v<N>.yaml` under `kind_api_version: "1.0.0"`.
- Set in the plugin manifest: `kind_api_version = "1"` (the plugin declares the major version it supports).
- **Major bump** — breaking change in the hook signature: removal/rename of a hook, change of `dispatch_class`, incompatible change of input/output schema.
- **Minor bump** — additive: a new optional hook, a new optional field in input/output schema.
- **Patch bump** — clarifications.

On a major bump (`v1` → `v2`), a new file `kinds/<kind>/v2.yaml` is created; the old one stays (legacy). A core MAY support both at once (compat shim).

Existing kinds:
- `tool` — v1.0.0 (`kinds/tool/v1.yaml`)
- `orchestrator` — v1.0.0 (`kinds/orchestrator/v1.yaml`)

## 3. `core_version`

The version of a specific core implementation:
- Python: the `dagstack-plugin-system` package on PyPI/Nexus, SemVer `0.x.y`.
- TypeScript: `@dagstack/plugin-system` on npm, SemVer `0.x.y`.
- Go: `go.dagstack.dev/plugin-system`, SemVer `v0.x.y`.

Each implementation declares in its `pyproject.toml` / `package.json` / `go.mod`:
- **Which `spec_schema_version`** values it supports (a range).
- **Which `kind_api_version`** values it supports for which kinds.

Compat matrix:

| Spec | Python core | TS core | Go core |
|---|---|---|---|
| 1.x | `dagstack-plugin-system >= 0.1.0` | `@dagstack/plugin-system >= 0.1.0` | (later) |

Pre-release `0.0.x.devN` versions (the current ones) do not strictly follow SemVer — they are "pre-Phase 1." Once `0.1.0` ships, SemVer applies.

## Policy: when to bump what

| Change | spec_schema | kind_api | core |
|---|---|---|---|
| Added a field to `manifest.schema.json` (optional) | minor | — | — (consumers regenerate) |
| Removed/renamed a field in `manifest.schema.json` | major | — | major (incompatible) |
| Added an optional hook to `kinds/tool/v1.yaml` | — | minor (1.0.0 → 1.1.0) | — |
| Removed a hook / changed input/output signature | — | major (`v1` → `v2`) | — |
| Changed the `dispatch_classes` enum (added a new value) | major | — | — (every core MUST update) |
| Bug fix in the Python core (no type changes) | — | — | patch |
| Performance optimization in the TS core | — | — | minor or patch |
| Reworked ADR-0001 (clarification, no schema change) | — | — | — (documentation) |

## Auto-validation

CI gate in `dagstack/plugin-system-spec`:
1. `make emit && git diff --exit-code` — generated artifacts are always in sync with the source.
2. (Phase 1+) `schema-diff` between the current and previous tag — disallows a major bump on the spec without an explicit `--breaking` flag in the commit message.

CI gate in cores (Python/TS/Go):
1. The `dagstack-plugin-system-spec` version pinned in the lock file MUST be a precise commit/tag (not `>=`) — otherwise a random spec change can break the build.
2. (Phase 1+) `compat-matrix-check` — declarations in `pyproject` / `package.json` / `go.mod` are validated against `_meta/`.
