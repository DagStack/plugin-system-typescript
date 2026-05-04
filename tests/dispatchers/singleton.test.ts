import { describe, expect, it } from "vitest";

import { AmbiguousPlugin, KindUnknown, SingletonDispatcher } from "../../src/index.js";
import { buildPlugin } from "../__fixtures__/plugins.js";

describe("SingletonDispatcher", () => {
  it("calls the only matching plugin", async () => {
    const d = new SingletonDispatcher<{ x: number }, number>("tool");
    const plugin = buildPlugin(
      { name: "echo", kind: "tool" },
      { run: async (input: { x: number }) => input.x * 2 },
    );
    expect(await d.dispatch([plugin], "run", { x: 5 })).toBe(10);
  });

  it("picks highest priority when multiple match", async () => {
    const d = new SingletonDispatcher<unknown, string>("tool");
    const a = buildPlugin({ name: "low", priority: 10 }, { run: async () => "low" });
    const b = buildPlugin({ name: "high", priority: 50 }, { run: async () => "high" });
    expect(await d.dispatch([a, b], "run", null)).toBe("high");
  });

  it("throws AmbiguousPlugin when two plugins share max priority", async () => {
    const d = new SingletonDispatcher<unknown, unknown>("tool");
    const a = buildPlugin({ name: "a", priority: 50 }, { run: async () => 1 });
    const b = buildPlugin({ name: "b", priority: 50 }, { run: async () => 2 });
    await expect(d.dispatch([a, b], "run", null)).rejects.toThrowError(AmbiguousPlugin);
  });

  it("throws KindUnknown when no plugin matches", async () => {
    const d = new SingletonDispatcher("tool");
    await expect(d.dispatch([], "run", null)).rejects.toThrowError(KindUnknown);
  });

  it("ignores plugins of a different kind", async () => {
    const d = new SingletonDispatcher<unknown, string>("tool");
    const orch = buildPlugin(
      { name: "orch", kind: "orchestrator" },
      { run: async () => "orchestrator" },
    );
    const tool = buildPlugin({ name: "echo", kind: "tool" }, { run: async () => "tool" });
    expect(await d.dispatch([orch, tool], "run", null)).toBe("tool");
  });

  it("throws when chosen plugin lacks the hook method", async () => {
    const d = new SingletonDispatcher("tool");
    const plugin = buildPlugin({ name: "no-method" }, {});
    await expect(d.dispatch([plugin], "run", null)).rejects.toThrow(
      /does not implement hook run/,
    );
  });
});
