// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/guides/configuration.mdx`.

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { PluginContext } from "../../src/index.js";

describe("guides/configuration.mdx — TypeScript", () => {
  it("snippet: zod schema validates ctx.config in setup()", async () => {
    const ConfigSchema = z.object({
      api_url: z.string().url(),
      timeout_ms: z.number().int().positive().default(30_000),
      retries: z.number().int().min(0).default(3),
    });
    type Config = z.infer<typeof ConfigSchema>;

    class MyPlugin {
      config!: Config;
      async setup(ctx: PluginContext): Promise<void> {
        this.config = ConfigSchema.parse(ctx.config);
      }
    }

    const plugin = new MyPlugin();
    await plugin.setup({
      config: { api_url: "https://api.example.com" },
      resources: { get: () => undefined } as unknown as PluginContext["resources"],
      manifest: {} as PluginContext["manifest"],
    });
    expect(plugin.config.api_url).toBe("https://api.example.com");
    expect(plugin.config.timeout_ms).toBe(30_000);
    expect(plugin.config.retries).toBe(3);
  });
});
