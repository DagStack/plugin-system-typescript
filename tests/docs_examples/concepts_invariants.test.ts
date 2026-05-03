// Mirror of TypeScript snippets in
// `dagstack-plugin-system-docs/site/docs/concepts/invariants.mdx`.

import { describe, expect, it } from "vitest";

import { ResourceRegistry } from "../../src/index.js";
import { buildManifest } from "../__fixtures__/plugins.js";

describe("concepts/invariants.mdx — TypeScript", () => {
  it("snippet 1: resources DI replaces module-scoped state", () => {
    interface DBClient {
      readonly tag: string;
    }

    class GoodPlugin {
      private db!: DBClient;
      async setup(ctx: { resources: ResourceRegistry }): Promise<void> {
        this.db = ctx.resources.get<DBClient>("postgres");
      }
      query(): DBClient {
        return this.db;
      }
    }

    const host = new ResourceRegistry();
    const fakeDb: DBClient = { tag: "test-pool" };
    host.register("postgres", fakeDb);

    const manifest = buildManifest({
      name: "good",
      resources: { required: ["postgres"] },
    });
    const scope = host.scopeFor(manifest);
    const plugin = new GoodPlugin();
    return plugin.setup({ resources: scope }).then(() => {
      expect(plugin.query().tag).toBe("test-pool");
    });
  });

  it("snippet 2: ProgressSink injection through resources (mock)", async () => {
    interface ProgressSink {
      update(event: { percent: number; message: string }): void;
    }
    const events: Array<{ percent: number; message: string }> = [];
    const sink: ProgressSink = {
      update: (e) => events.push(e),
    };

    class GoodPlugin {
      private progress!: ProgressSink;
      async setup(ctx: { resources: ResourceRegistry }): Promise<void> {
        this.progress = ctx.resources.get<ProgressSink>("progress");
      }
      async process(): Promise<void> {
        this.progress.update({ percent: 0.5, message: "Halfway there" });
      }
    }

    const host = new ResourceRegistry();
    host.register("progress", sink);
    const manifest = buildManifest({
      name: "good",
      resources: { required: ["progress"] },
    });

    const plugin = new GoodPlugin();
    await plugin.setup({ resources: host.scopeFor(manifest) });
    await plugin.process();
    expect(events).toEqual([{ percent: 0.5, message: "Halfway there" }]);
  });
});
