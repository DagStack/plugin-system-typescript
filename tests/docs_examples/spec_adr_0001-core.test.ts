// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/spec/adr/0001-core.mdx`.

import { describe, expect, it } from "vitest";

import type { PluginContext } from "../../src/index.js";

describe("spec/adr/0001-core.mdx — TypeScript", () => {
  it("snippet: EchoPlugin with setup/teardown lifecycle hooks", async () => {
    class EchoPlugin {
      private ctx?: PluginContext;
      async setup(ctx: PluginContext): Promise<void> {
        this.ctx = ctx;
      }
      async teardown(): Promise<void> {
        this.ctx = undefined;
      }
      hasContext(): boolean {
        return this.ctx !== undefined;
      }
    }

    const plugin = new EchoPlugin();
    await plugin.setup({
      config: {},
      resources: {} as PluginContext["resources"],
      manifest: {} as PluginContext["manifest"],
    });
    expect(plugin.hasContext()).toBe(true);
    await plugin.teardown();
    expect(plugin.hasContext()).toBe(false);
  });
});
