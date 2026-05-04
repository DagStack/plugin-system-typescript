// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/guides/lifecycle.mdx`.

import { describe, expect, it } from "vitest";

import { PluginRegistry } from "../../src/index.js";
import type { PluginContext } from "../../src/index.js";
import { buildManifest } from "../__fixtures__/plugins.js";

describe("guides/lifecycle.mdx — TypeScript", () => {
  it("snippet: setup/teardown lifecycle hooks via attached instance", async () => {
    class MyPlugin {
      ready = false;
      async setup(_ctx: PluginContext): Promise<void> {
        this.ready = true;
      }
      async teardown(): Promise<void> {
        this.ready = false;
      }
    }

    const registry = new PluginRegistry();
    registry.registerManifest(buildManifest({ name: "my", kind: "tool" }));
    const plugin = new MyPlugin();
    registry.attachPlugin("my", plugin);

    await registry.setupAll();
    expect(plugin.ready).toBe(true);

    await registry.teardownAll();
    expect(plugin.ready).toBe(false);
  });
});
