# Changelog

All notable changes to `@dagstack/plugin-system` are recorded in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning — [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] — 2026-05-03

Patch release. Architect review on the just-published `0.2.0` flagged three must-fix items — all behaviour or security. No surface change to any documented API; safe drop-in upgrade for `0.2.0` consumers.

### Fixed

- **STOP_CHAIN sentinel** added to `ChainDispatcher`. A chain plugin that returns `STOP_CHAIN` short-circuits the chain; the dispatcher returns the value that was fed _into_ the short-circuiting hook. Mirrors `dagstack.plugin_system.dispatch.STOP_CHAIN` (Python) — restores cross-binding parity for chain dispatch. Exported as `STOP_CHAIN` symbol from the package root.
- **Path-traversal guard** in `loadInstance`. A manifest's `entry_point` like `"../../../etc/somewhere.js#X"` no longer escapes the manifest's own directory; such manifests fail with a clear error and are skipped (continue-on-failure). The runtime now refuses to dynamic-import code outside the plugin tree.
- **Class-detection robustness** in `loadInstance`. The previous source-level regex (`/^class\s/.test(toString())`) misidentified classes after minification (terser, swc, esbuild with downlevel target). Replaced with a `new`-first / factory-fallback strategy that survives transpilation.

### Added

- 2 new tests covering STOP_CHAIN behaviour and the path-traversal guard.

## [0.2.0] — 2026-05-03

Phase 1 runtime release. Closes epic [#9](https://git.goldix.org/dagstack/plugin-system-typescript/issues/9) — five of six sub-tasks merged (TS-1 core registry, TS-2 file-based discovery, TS-3 dispatchers, TS-4 lifecycle, TS-6 docs flip; TS-5 cross-binding conformance suite is deferred — see *Not yet implemented* below).

**Migration from 0.1.0**: no breaking changes. The Phase 0 surface (`VERSION`, `ToolV1`, `OrchestratorV1`) is preserved; the runtime is purely additive.

### Added (TS-1, [#10](https://git.goldix.org/dagstack/plugin-system-typescript/issues/10))

- `PluginRegistry` class with `registerManifest`, `getPlugin`, `resolve`, `list`, `getCoreVersion`. Priority-ordered lookup; ties raise `AmbiguousPlugin` (see TS-3 selection policy). Cross-binding-parity API shape with `dagstack-plugin-system` (Python).
- `PluginManifestSchema` — zod-validated manifest contract mirroring `dagstack/plugin-system-spec/_meta/manifest.schema.json`. Cross-field invariants (`entry_point` for `in_process`, `command` for `mcp_stdio`, `url` for `mcp_http`; `tryfirst` and `trylast` are mutually exclusive).
- Sentinel-style errors: `AmbiguousPlugin`, `KindUnknown`, `ManifestInvalid`, `VersionIncompatible`, `PluginLoadError`, plus `is*` type-guards (`errors.Is`-style parity with Go).
- `VERSION` bumped to `0.2.0`.

### Added (TS-2, [#12](https://git.goldix.org/dagstack/plugin-system-typescript/issues/12))

- `discover(registry, rootPath, options?)` — file-based plugin discovery walking a directory tree for `dagstack.json` and `dagstack.toml` manifests. Mirrors Python's `dagstack.plugin_system.discovery.discover` per ADR-0006.
- TOML parsing via `smol-toml` (ESM-native, TOML 1.0 compliant).
- Default ignore-list (`node_modules`, `.git`, `dist`, `build`, `.next`, `.cache`, `.venv*`, `__pycache__`, …) plus customizable `options.ignore` patterns (`*`, `?`, `[abc]`).
- Continue-on-failure: a malformed manifest does not abort the walk; failures are returned in `result.failures` and logged via `console.warn`.
- Auto-unwrap of `[plugin]` section in TOML (`{ plugin: { … } }` → `{ … }`) for cross-binding parity with Python's TOML format.

### Added (TS-4, [#16](https://git.goldix.org/dagstack/plugin-system-typescript/issues/16))

- `PluginContext` interface and `ResourceRegistry` class — host registers named resources globally, plugins receive a per-plugin scope per `manifest.resources.required` / `optional`.
- `topoSort(manifests)` — dependency-aware topological sort with cycle and missing-reference detection.
- `PluginRegistry.attachPlugin(name, instance)` — attach an out-of-band-built instance to a registered manifest.
- `PluginRegistry.setupAll(opts)` — topo-order traversal: dynamic-import any unattached `entry_point`, instantiate (`new` for classes, call for factories), inject `PluginContext`, await `setup?.(ctx)`. Continue-on-failure: a failing plugin is logged and excluded from `getLoadedPlugins()`.
- `PluginRegistry.teardownAll()` — reverse-order teardown, `TeardownErrors` aggregates per-plugin failures while still draining the rest. Idempotent.
- `PluginRegistry.getLoadedPlugins()` — returns `LoadedPlugin[]` ready for any of the five dispatchers.
- New errors: `DependencyCycle`, `MissingDependency`, `TeardownErrors`, with matching `is*` type-guards.
- Entry-point resolution: `./relative.js#ClassName` (relative to manifest directory), bare `@scope/pkg` specifiers, default-export factories or classes.

### Added (TS-3, [#14](https://git.goldix.org/dagstack/plugin-system-typescript/issues/14))

Five dispatcher classes implementing ADR-0002 §"Hook invocation semantics":

- `SingletonDispatcher` — one active plugin per kind. Selection: priority desc; ties → `AmbiguousPlugin`.
- `BroadcastCollectDispatcher` — fan-out via `Promise.all`, results collected into an array. Errors propagate.
- `BroadcastNotifyDispatcher` — fan-out via `Promise.allSettled`. Errors swallowed and logged; result reports `delivered` count and `failed[]` list.
- `ChainDispatcher` — sequential, output → next input. Order: `tryfirst` band → normal band → `trylast` band, priority desc within each, registration order on ties (pluggy semantics).
- `CapabilityDispatcher` — selection by `manifest.capabilities` ⊃ `required`. `fallback: true` plugins kick in only when no non-fallback satisfies.

Common surface: `Dispatcher<I, O>` interface, `LoadedPlugin` type, `orderForChain()` helper.

### Added (TS-6, docs flip)

- All TypeScript admonitions across `plugin-system.dagstack.dev` replaced with working code that exercises the runtime shipped in this release. Per-page tests under `tests/docs_examples/` mirror every snippet verbatim and run on `npm test`. Coverage gate (`audit-docs-examples.sh`) is in hard-fail mode against this surface.

### Not yet implemented

- Cross-binding conformance suite — TS-5. Awaits `dagstack/plugin-system-spec/_meta/conformance/` fixtures.
- Subprocess runtimes (`mcp_stdio`, `mcp_http`) — Phase 2.
- Hot-reload (watch-mode discovery) — Phase 2.
- Custom-hookspec testing infrastructure for application-defined kinds — cross-binding work in spec.

## [0.1.0] - 2026-04-30

First public stable release. Same Phase 0 surface as `0.1.0-rc.2` (spec-emitted types only — `VERSION`, `ToolV1`, `OrchestratorV1`); the runtime lands in Phase 1.

Cross-binding parity with Python `dagstack-plugin-system 0.4.0` and Go `go.dagstack.dev/plugin-system 0.1.0` on the canonical manifest contract.

### Added (since rc.2)

- `tests/docs_examples/` — verbatim mirrors of every TypeScript `<TabItem>` snippet on `plugin-system.dagstack.dev`. 100% page coverage (11 tests; pages whose snippets reference the unshipped runtime carry the documented "Phase 1" admonition).
- Spec submodule pin updated to canonical `core_version` (post `dagstack/plugin-system-spec` PR #8).

## [0.1.0-rc.2] - 2026-04-28

Same surface as `0.1.0-rc.1`; bumped to clear an aborted tag where the
publish workflow failed on `npm ci` because `package-lock.json` was not
yet checked in. The lockfile now ships with the repo.

## [0.1.0-rc.1] - 2026-04-28

First public release candidate of the TypeScript binding for
`dagstack/plugin-system-spec` v1.0. Phase 0 surface — spec-emitted kind
contracts only; the runtime (`PluginRegistry`, `discover`, dispatchers,
contract tests) lands in Phase 1.

### Added

- **Generated kind contracts** — `ToolV1` and `OrchestratorV1` namespaces
  re-exported from `src/_generated/kinds/<kind>/v1.ts`. Each namespace
  exposes `KIND_NAME`, `KIND_API_VERSION`, zod schemas (`ExecuteInputSchema`,
  `ExecuteOutputSchema`, etc.), inferred TS types, the `<Kind>Plugin`
  interface, and `HOOK_DISPATCH` / `HOOK_MCP_EXPOSED` metadata maps.
- **`VERSION`** constant exported from the package root.
- **Single-toolchain emit pipeline** — `npm run emit` runs the spec's
  Python emitter (`spec/emitters/typescript_zod.py`) via `uv` and writes
  to `src/_generated/`. CI gate (Phase 1+) will assert that emit is in
  lockstep with the pinned spec submodule.

### Spec pin

- `spec` submodule pinned at `dagstack/plugin-system-spec@main` (post-PR #7
  English translation of `kinds/*` + `_meta/*` + emitters).

### Phase 0 caveats

- No runtime yet: `PluginRegistry`, `discover`, dispatchers, MCP adapters,
  and contract tests are out of scope for `0.1.x`. Plugin authors can
  already implement against the kind interfaces and run their own
  registration; the orchestrator-neutral runtime ships in Phase 1.
- No `eslint` / `prettier` / `vitest` configured yet; the placeholders
  return success. CI workflow lands together with the runtime.
