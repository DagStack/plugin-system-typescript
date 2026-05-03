// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/guides/testing.mdx`.

import { describe, expect, it } from "vitest";

import {
  PluginRegistry,
  ResourceRegistry,
  SingletonDispatcher,
} from "../../src/index.js";

class EchoPlugin {
  async setup(): Promise<void> {}
  async execute(args: { msg: string }): Promise<{ echoed: string }> {
    return { echoed: args.msg };
  }
  async teardown(): Promise<void> {}
}

describe("guides/testing.mdx — TypeScript", () => {
  it("snippet: testing the echo plugin via attach + dispatcher", async () => {
    const registry = new PluginRegistry();
    registry.registerManifest({
      schema_version: "1.0.0",
      name: "echo",
      kind: "tool",
      kind_api_version: "1.0.0",
      core_version: "^0.2.0",
      runtime: "in_process",
      entry_point: "./plugin.js#EchoPlugin",
    });
    registry.attachPlugin("echo", new EchoPlugin());
    await registry.setupAll({ resources: new ResourceRegistry() });

    const dispatcher = new SingletonDispatcher<{ msg: string }, { echoed: string }>("tool");
    const result = await dispatcher.dispatch(
      registry.getLoadedPlugins(),
      "execute",
      { msg: "hi" },
    );

    expect(result.echoed).toBe("hi");
    await registry.teardownAll();
  });
});
