import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DependencyCycle,
  isDependencyCycle,
  isMissingDependency,
  isTeardownErrors,
  MissingDependency,
  PluginRegistry,
  ResourceRegistry,
  TeardownErrors,
  topoSort,
} from "../src/index.js";
import { buildManifest } from "./__fixtures__/plugins.js";

describe("topoSort", () => {
  it("orders dependencies before dependents", () => {
    const a = buildManifest({ name: "a" });
    const b = buildManifest({ name: "b", depends_on: ["a"] });
    const c = buildManifest({ name: "c", depends_on: ["b"] });
    const sorted = topoSort([c, b, a]);
    const positions = sorted.map((m) => m.name);
    expect(positions.indexOf("a")).toBeLessThan(positions.indexOf("b"));
    expect(positions.indexOf("b")).toBeLessThan(positions.indexOf("c"));
  });

  it("throws DependencyCycle on a cyclic graph", () => {
    const a = buildManifest({ name: "a", depends_on: ["b"] });
    const b = buildManifest({ name: "b", depends_on: ["a"] });
    expect(() => topoSort([a, b])).toThrowError(DependencyCycle);
    try {
      topoSort([a, b]);
    } catch (err) {
      expect(isDependencyCycle(err)).toBe(true);
    }
  });

  it("throws MissingDependency on dangling reference", () => {
    const a = buildManifest({ name: "a", depends_on: ["nonexistent"] });
    expect(() => topoSort([a])).toThrowError(MissingDependency);
    try {
      topoSort([a]);
    } catch (err) {
      expect(isMissingDependency(err)).toBe(true);
    }
  });

  it("handles parallel branches deterministically", () => {
    const root = buildManifest({ name: "root" });
    const left = buildManifest({ name: "left", depends_on: ["root"] });
    const right = buildManifest({ name: "right", depends_on: ["root"] });
    const top = buildManifest({ name: "top", depends_on: ["left", "right"] });
    const sorted = topoSort([top, right, left, root]);
    const positions = sorted.map((m) => m.name);
    expect(positions.indexOf("root")).toBeLessThan(positions.indexOf("left"));
    expect(positions.indexOf("root")).toBeLessThan(positions.indexOf("right"));
    expect(positions.indexOf("left")).toBeLessThan(positions.indexOf("top"));
    expect(positions.indexOf("right")).toBeLessThan(positions.indexOf("top"));
  });
});

describe("PluginRegistry — lifecycle (attached instances)", () => {
  it("setupAll calls instance.setup with PluginContext", async () => {
    const registry = new PluginRegistry();
    registry.registerManifest({ ...buildManifest({ name: "echo" }) });

    let receivedConfig: unknown;
    let receivedManifest: { name: string } | undefined;
    registry.attachPlugin("echo", {
      async setup(ctx: { config: Record<string, unknown>; manifest: { name: string } }) {
        receivedConfig = ctx.config;
        receivedManifest = ctx.manifest;
      },
    });
    await registry.setupAll({ configs: { echo: { foo: 1 } } });
    expect(receivedConfig).toEqual({ foo: 1 });
    expect(receivedManifest?.name).toBe("echo");
  });

  it("setupAll is idempotent for already-set-up plugins (instance not re-imported)", async () => {
    const registry = new PluginRegistry();
    registry.registerManifest({ ...buildManifest({ name: "echo" }) });
    let setupCount = 0;
    registry.attachPlugin("echo", {
      async setup() {
        setupCount += 1;
      },
    });
    await registry.setupAll();
    await registry.setupAll();
    // Each setupAll call invokes setup() — the instance is reused, but
    // setup() is invoked again. Idempotency on setup-side is the
    // plugin's responsibility (mirrors Python).
    expect(setupCount).toBe(2);
  });

  it("setupAll respects depends_on order (parent set up before child)", async () => {
    const registry = new PluginRegistry();
    registry.registerManifest(buildManifest({ name: "base" }));
    registry.registerManifest(buildManifest({ name: "child", depends_on: ["base"] }));
    const order: string[] = [];
    registry.attachPlugin("child", {
      async setup() {
        order.push("child");
      },
    });
    registry.attachPlugin("base", {
      async setup() {
        order.push("base");
      },
    });
    await registry.setupAll();
    expect(order).toEqual(["base", "child"]);
  });

  it("setupAll continues after a single plugin fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const registry = new PluginRegistry();
      registry.registerManifest(buildManifest({ name: "broken" }));
      registry.registerManifest(buildManifest({ name: "good" }));
      registry.attachPlugin("broken", {
        async setup() {
          throw new Error("boom");
        },
      });
      let goodSetUp = false;
      registry.attachPlugin("good", {
        async setup() {
          goodSetUp = true;
        },
      });
      await registry.setupAll();
      expect(goodSetUp).toBe(true);
      const loaded = registry.getLoadedPlugins().map((p) => p.manifest.name);
      expect(loaded).toEqual(["good"]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("setupAll injects ResourceRegistry scope into ctx", async () => {
    const registry = new PluginRegistry();
    registry.registerManifest(
      buildManifest({ name: "needy", resources: { required: ["http_client"] } }),
    );
    let received: unknown;
    registry.attachPlugin("needy", {
      async setup(ctx: { resources: ResourceRegistry }) {
        received = ctx.resources.get("http_client");
      },
    });
    const host = new ResourceRegistry();
    host.register("http_client", "axios-instance");
    await registry.setupAll({ resources: host });
    expect(received).toBe("axios-instance");
  });

  it("getLoadedPlugins returns only plugins that survived setupAll", async () => {
    const registry = new PluginRegistry();
    registry.registerManifest(buildManifest({ name: "no-instance" }));
    registry.registerManifest(buildManifest({ name: "with-instance" }));
    registry.attachPlugin("with-instance", {});
    expect(registry.getLoadedPlugins().map((p) => p.manifest.name)).toEqual(["with-instance"]);
  });

  it("teardownAll runs teardown in reverse setup order", async () => {
    const registry = new PluginRegistry();
    registry.registerManifest(buildManifest({ name: "a" }));
    registry.registerManifest(buildManifest({ name: "b", depends_on: ["a"] }));
    const order: string[] = [];
    registry.attachPlugin("a", {
      async teardown() {
        order.push("a");
      },
    });
    registry.attachPlugin("b", {
      async teardown() {
        order.push("b");
      },
    });
    await registry.teardownAll();
    expect(order).toEqual(["b", "a"]);
  });

  it("teardownAll aggregates errors into TeardownErrors and still tears down the rest", async () => {
    const registry = new PluginRegistry();
    registry.registerManifest(buildManifest({ name: "good" }));
    registry.registerManifest(buildManifest({ name: "broken" }));
    let goodTornDown = false;
    registry.attachPlugin("good", {
      async teardown() {
        goodTornDown = true;
      },
    });
    registry.attachPlugin("broken", {
      async teardown() {
        throw new Error("teardown-fail");
      },
    });
    await expect(registry.teardownAll()).rejects.toThrowError(TeardownErrors);
    expect(goodTornDown).toBe(true);
    try {
      await registry.teardownAll();
    } catch (err) {
      expect(isTeardownErrors(err)).toBe(true);
    }
  });

  it("teardownAll is idempotent (running twice is a no-op)", async () => {
    const registry = new PluginRegistry();
    registry.registerManifest(buildManifest({ name: "a" }));
    let count = 0;
    registry.attachPlugin("a", {
      async teardown() {
        count += 1;
      },
    });
    await registry.teardownAll();
    await registry.teardownAll();
    expect(count).toBe(1);
  });
});

describe("PluginRegistry — lifecycle (dynamic import from temp file)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "dagstack-lifecycle-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("rejects entry_point that escapes the manifest directory (path-traversal guard)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await mkdir(join(tmp, "bad"), { recursive: true });
      const manifest = {
        schema_version: "1.0.0",
        name: "bad",
        kind: "tool",
        kind_api_version: "1.0.0",
        core_version: "^0.2.0",
        runtime: "in_process",
        entry_point: "../../../etc/whatever.mjs#X",
      };
      const registry = new PluginRegistry();
      registry.registerManifest(manifest, `file:${join(tmp, "bad", "dagstack.json")}`);
      await registry.setupAll();
      // Continue-on-failure: plugin is excluded from getLoadedPlugins.
      expect(registry.getLoadedPlugins()).toHaveLength(0);
      // Warning was logged with the escape diagnostic.
      const calls = warnSpy.mock.calls.map((c) => c.join(" "));
      expect(calls.some((c) => /escapes the manifest directory/.test(c))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("loads plugin from entry_point=./plugin.js#PluginClass", async () => {
    await mkdir(join(tmp, "echo"), { recursive: true });
    const plugin = `
export class EchoPlugin {
  async setup() { this.ready = true; }
  greet(name) { return 'hello, ' + name; }
}
`;
    await writeFile(join(tmp, "echo", "plugin.mjs"), plugin);
    const manifest = {
      schema_version: "1.0.0",
      name: "echo",
      kind: "tool",
      kind_api_version: "1.0.0",
      core_version: "^0.2.0",
      runtime: "in_process",
      entry_point: "./plugin.mjs#EchoPlugin",
    };
    await writeFile(join(tmp, "echo", "dagstack.json"), JSON.stringify(manifest));
    const registry = new PluginRegistry();
    registry.registerManifest(manifest, `file:${join(tmp, "echo", "dagstack.json")}`);
    await registry.setupAll();
    const loaded = registry.getLoadedPlugins();
    expect(loaded).toHaveLength(1);
    const inst = loaded[0].instance as { ready?: boolean; greet: (n: string) => string };
    expect(inst.ready).toBe(true);
    expect(inst.greet("world")).toBe("hello, world");
  });
});
