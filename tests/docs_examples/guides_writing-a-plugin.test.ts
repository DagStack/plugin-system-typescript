// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/guides/writing-a-plugin.mdx`.

import { describe, expect, it } from "vitest";

import type { PluginContext } from "../../src/index.js";

describe("guides/writing-a-plugin.mdx — TypeScript", () => {
  it("snippet: FixedChunker reads chunk_size from ctx.config", async () => {
    class FixedChunker {
      private chunkSize = 200;
      async setup(ctx: PluginContext): Promise<void> {
        if (typeof ctx.config.chunk_size === "number") {
          this.chunkSize = ctx.config.chunk_size;
        }
      }
      async chunk(input: { text: string }): Promise<{ chunks: string[] }> {
        const chunks: string[] = [];
        for (let i = 0; i < input.text.length; i += this.chunkSize) {
          chunks.push(input.text.slice(i, i + this.chunkSize));
        }
        return { chunks };
      }
      async teardown(): Promise<void> {}
    }

    const plugin = new FixedChunker();
    await plugin.setup({
      config: { chunk_size: 5 },
      resources: { get: () => undefined } as unknown as PluginContext["resources"],
      manifest: {} as PluginContext["manifest"],
    });
    const result = await plugin.chunk({ text: "abcdefghij" });
    expect(result.chunks).toEqual(["abcde", "fghij"]);
    await plugin.teardown();
  });
});
