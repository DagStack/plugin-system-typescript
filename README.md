# @dagstack/plugin-system

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/badge/npm-%40dagstack%2Fplugin--system-blue.svg)](https://www.npmjs.com/package/@dagstack/plugin-system)

TypeScript / Node.js implementation of [`dagstack/plugin-system`](https://github.com/dagstack/plugin-system-spec).

### What's in `0.2.0` (Phase 1 runtime)

- `PluginRegistry` with `registerManifest`, `attachPlugin`, `setupAll`, `teardownAll`, `getLoadedPlugins`, `getCoreVersion`.
- File-based discovery (`discover()`) — `dagstack.json` and `dagstack.toml`.
- All five dispatchers — singleton, broadcast_collect, broadcast_notify, chain, capability.
- Lifecycle — topological sort by `depends_on`, `PluginContext`, `ResourceRegistry`.
- Sentinel-style errors with `is*` type guards (cross-realm-safe via `Symbol.for`).

Spec-emitted kind contracts (`ToolV1`, `OrchestratorV1`) carry over from `0.1.0` unchanged — the runtime is additive, no breaking changes for `0.1.0` consumers. Subprocess runtimes (`mcp_stdio`, `mcp_http`) and the cross-binding conformance suite land in Phase 2.

Sister implementations:

- [`dagstack/plugin-system-python`](https://github.com/dagstack/plugin-system-python) — `pip install dagstack-plugin-system`.
- [`dagstack/plugin-system-go`](https://github.com/dagstack/plugin-system-go) — `go.dagstack.dev/plugin-system`.

## Install

```bash
npm install @dagstack/plugin-system
```

## Usage

Discover plugins from a directory and route calls through a dispatcher:

```typescript
import {
  PluginRegistry,
  discover,
  SingletonDispatcher,
} from "@dagstack/plugin-system";

const registry = new PluginRegistry();
await discover(registry, "plugins/");
await registry.setupAll();

const dispatcher = new SingletonDispatcher<{ msg: string }, { echoed: string }>("tool");
const result = await dispatcher.dispatch(
  registry.getLoadedPlugins(),
  "execute",
  { msg: "hello" },
);
console.log(result); // { echoed: "hello" }

await registry.teardownAll();
```

Implement a plugin against the spec-emitted kind contract:

```typescript
import type { PluginContext } from "@dagstack/plugin-system";
import { ToolV1 } from "@dagstack/plugin-system";

export class EchoPlugin implements ToolV1.ToolPlugin {
  async setup(_ctx: PluginContext): Promise<void> {}

  get_schema(_payload: ToolV1.Empty): ToolV1.GetSchemaOutput {
    return [
      {
        name: "echo",
        description: "Echo back the input",
        parameters: { type: "object", properties: { msg: { type: "string" } } },
      },
    ];
  }

  execute(payload: ToolV1.ExecuteInput): ToolV1.ExecuteOutput {
    return { result: { echoed: (payload.args as { msg: string }).msg } };
  }
}
```

Full guides on each of the five dispatch classes, manifests, lifecycle, and resources DI live at [`plugin-system.dagstack.dev`](https://plugin-system.dagstack.dev).

## Development

Building from source requires [`uv`](https://docs.astral.sh/uv/) — used to run the spec's Python emitters, a single toolchain across all language bindings. Plain `npm install @dagstack/plugin-system` does not need `uv`.

```bash
git clone https://github.com/dagstack/plugin-system-typescript.git
cd plugin-system-typescript
git submodule update --init --recursive
npm install
npm run emit          # regenerate src/_generated/ from spec/
npm run build         # tsc -b → dist/
```

CI gate in this repo (Phase 1+): `npm run emit && git diff --exit-code src/_generated/`.

## Architecture

### Kind contracts — generated, not hand-written

All kind interfaces (`ToolPlugin`, `OrchestratorPlugin`, ... and the future `VectorStorePlugin`, `ChunkerPlugin`, ...) are emitted from `dagstack/plugin-system-spec` so the contract stays in lockstep with the Python implementation. Never edit `src/_generated/` by hand.

```
spec/kinds/tool/v1.yaml + schemas/*.json
        │ uv run spec/emitters/typescript_zod.py
        ▼
src/_generated/kinds/tool/v1.ts   (z.object + z.infer + interface)
        │ tsc -b
        ▼
dist/_generated/kinds/tool/v1.{js,d.ts}
        │ exports in package.json
        ▼
import { ToolV1 } from "@dagstack/plugin-system"
```

### Phase 1 scope (shipped in 0.2.0)

- `PluginManifest` validation (zod, mirrors `_meta/manifest.schema.json`).
- `PluginRegistry` — `registerManifest`, `attachPlugin`, `setupAll`, `teardownAll`, `getLoadedPlugins`.
- File-based discovery (`discover()`) — `dagstack.json` and `dagstack.toml`, ADR-0006.
- Five dispatch classes (Singleton / Broadcast-Collect / Broadcast-Notify / Chain / Capability — ADR-0002).
- Lifecycle: topological sort by `depends_on`, `PluginContext`, `ResourceRegistry`.
- Sentinel errors with `is*` type guards (cross-realm-safe via `Symbol.for`).

### Phase 2 scope

- MCP adapters (`MCPStdioAdapter`, `MCPHttpAdapter`) — JSON-RPC over stdio/HTTP.
- Cross-binding conformance suite (fixtures from `_meta/conformance/`).
- Hot-reload (watch-mode discovery).
- Custom-hookspec testing infrastructure for application-defined kinds.

## Compatibility matrix

| @dagstack/plugin-system | dagstack/plugin-system-spec | `dagstack-plugin-system` (Python) | `go.dagstack.dev/plugin-system` |
|---|---|---|---|
| 0.2.0 | v1.0 (post canonical `core_version`) | 0.4.1 | v0.1.0 |
| 0.1.0 | v1.0 — types-only, no runtime | 0.4.1 | v0.1.0 |

The full SemVer policy across `core`, `kind_api`, and the manifest schema is documented in [`dagstack/plugin-system-spec/_meta/versioning.md`](https://github.com/dagstack/plugin-system-spec/blob/main/_meta/versioning.md).

## License

Apache-2.0.
