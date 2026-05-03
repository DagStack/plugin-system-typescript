// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/spec/adr/0003-runtime-invariants.mdx`.

import { describe, expect, it } from "vitest";

import { ResourceRegistry } from "../../src/index.js";
import type { PluginContext } from "../../src/index.js";
import { buildManifest } from "../__fixtures__/plugins.js";

describe("spec/adr/0003-runtime-invariants.mdx — TypeScript", () => {
  it("snippet: Resources DI through PluginContext", async () => {
    interface HttpClient {
      readonly tag: string;
    }

    class GoodPlugin {
      private http!: HttpClient;
      async setup(ctx: PluginContext): Promise<void> {
        this.http = ctx.resources.get<HttpClient>("http_client");
      }
      tag(): string {
        return this.http.tag;
      }
    }

    const host = new ResourceRegistry();
    host.register("http_client", { tag: "test-client" });
    const manifest = buildManifest({
      name: "good",
      resources: { required: ["http_client"] },
    });
    const plugin = new GoodPlugin();
    await plugin.setup({
      config: {},
      resources: host.scopeFor(manifest),
      manifest,
    });
    expect(plugin.tag()).toBe("test-client");
  });
});
