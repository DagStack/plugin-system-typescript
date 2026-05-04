# TypeScript / Node.js naming (plugin-system)

## Distribution names (npm scope)

The `@dagstack` scope is reserved on npmjs.org and (Phase 1+) on the internal Nexus npm registry.
dagstack is an **umbrella brand**, plugin-system is one of the products; the package is product-scoped:

| Purpose | Package name | Example |
|---|---|---|
| Plugin-system core | `@dagstack/plugin-system` | `npm install @dagstack/plugin-system` |
| Spec helper (optional) | `@dagstack/plugin-system-spec` | `npm install @dagstack/plugin-system-spec` |
| Plugin: `@dagstack/plugin-system-<kind>-<name>` | `@dagstack/plugin-system-vector-store-qdrant` | as is |
| Multi-plugin from a single maintainer | `@<vendor>/dagstack-plugin-system-<name>` | `@acme/dagstack-plugin-system-tools` |
| Other dagstack products | `@dagstack/<product>` | `@dagstack/governance`, `@dagstack/training` |

> Heads-up: `<kind>-<name>` in the package name uses kebab-case (npm convention), not snake_case as in the manifest / Python. The manifest still uses `kind = "vector_store", name = "qdrant"`.

## Import paths

```typescript
// Core
import { PluginRegistry, PluginManifest } from '@dagstack/plugin-system';

// Plugins — each from its own package
import { QdrantStore } from '@dagstack/plugin-system-vector-store-qdrant';
import { TreeSitterChunker } from '@dagstack/plugin-system-chunker-tree-sitter';
```

Unlike Python (PEP 420 namespace), TS does not have a "virtual" sub-namespace — each plugin is imported directly from its own npm package.

## Plugin registration

In a plugin's `package.json`:
```json
{
  "name": "@dagstack/plugin-system-vector-store-qdrant",
  "version": "0.1.0",
  "exports": {
    ".": "./dist/index.js"
  },
  "dagstack": {
    "manifest": "./dagstack-plugin.toml"
  }
}
```

Discovery through the `dagstack.manifest` field in `package.json` — the host scans `node_modules/@dagstack/*/package.json` and reads the manifest at the indicated path.

Alternative: `dagstack-plugin.json` at the package root (no TOML — JSON for simplicity in the JS ecosystem).

## TypeScript types

Generated in the core from `dagstack/plugin-system-spec`:
```typescript
// @dagstack/plugin-system/_generated/kinds/tool/v1.ts
import { z } from 'zod';

export const ToolGetSchemaOutput = z.array(z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string(),
  parameters: z.object({}).passthrough(),
}));

export interface ToolPlugin {
  get_schema(): z.infer<typeof ToolGetSchemaOutput>;
  execute(input: z.infer<typeof ToolExecuteInput>): z.infer<typeof ToolExecuteOutput>;
}
```

Plugin author:
```typescript
import { ToolPlugin } from '@dagstack/plugin-system/kinds/tool/v1';

export class MyTool implements ToolPlugin {
  get_schema() { ... }
  execute(input) { ... }
}
```

## Lock file and monorepo

Because the core and plugins evolve together, hosting in a monorepo with pnpm/npm workspaces is recommended (optional for the core, required for multi-plugin authors).

In our ecosystem, the `dagstack/plugin-system-typescript` repo holds `@dagstack/plugin-system`. Plugins live each in its own repo (`dagstack/plugin-system-vector-store-qdrant-ts` etc.) or in a shared `dagstack/plugin-system-plugins-typescript` monorepo (a Phase 1+ decision).
