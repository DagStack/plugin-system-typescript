// Mirror of TypeScript snippets in
// `dagstack-plugin-system-docs/site/docs/concepts/registry.mdx`.

import { describe, expect, it } from "vitest";

import { PluginRegistry } from "../../src/index.js";

const validManifest = (overrides: Record<string, unknown> = {}) => ({
  schema_version: "1.0.0",
  name: "echo",
  kind: "tool",
  kind_api_version: "1.0.0",
  core_version: "^0.2.0",
  runtime: "in_process",
  entry_point: "./plugin.js#EchoPlugin",
  ...overrides,
});

describe("concepts/registry.mdx — TypeScript", () => {
  it("snippet: register + list + getPlugin + getLoadedPlugins + teardownAll", async () => {
    const registry = new PluginRegistry();
    registry.registerManifest(validManifest({ name: "llm-openai", kind: "llm" }));
    registry.registerManifest(validManifest({ name: "echo", kind: "tool" }));

    const llmManifest = registry.getPlugin("llm");
    expect(llmManifest.name).toBe("llm-openai");

    const names: string[] = [];
    for (const m of registry.list()) {
      names.push(`${m.kind}:${m.name}`);
    }
    expect(names).toEqual(["llm:llm-openai", "tool:echo"]);

    // No instances attached → loaded list is empty.
    expect(registry.getLoadedPlugins()).toEqual([]);

    await registry.teardownAll();
  });
});
