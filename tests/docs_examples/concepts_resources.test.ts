// Mirror of TypeScript snippets in
// `dagstack-plugin-system-docs/site/docs/concepts/resources.mdx`.

import { describe, expect, it } from "vitest";

import { PluginRegistry, ResourceRegistry } from "../../src/index.js";
import type { PluginContext } from "../../src/index.js";

describe("concepts/resources.mdx — TypeScript", () => {
  it("snippet: host registers, plugin gets per-manifest scope through setupAll", async () => {
    const registry = new PluginRegistry();
    registry.registerManifest({
      schema_version: "1.0.0",
      name: "good",
      kind: "tool",
      kind_api_version: "1.0.0",
      core_version: "^0.2.0",
      runtime: "in_process",
      entry_point: "./plugin.js#Good",
      resources: { required: ["http_client"] },
    });

    const httpClient = { fetch: async () => "stub" };
    const resources = new ResourceRegistry();
    resources.register("http_client", httpClient);

    let received: typeof httpClient | undefined;

    class GoodPlugin {
      async setup(ctx: PluginContext): Promise<void> {
        received = ctx.resources.get<typeof httpClient>("http_client");
      }
    }

    registry.attachPlugin("good", new GoodPlugin());
    await registry.setupAll({ resources });

    expect(received).toBe(httpClient);
  });
});
