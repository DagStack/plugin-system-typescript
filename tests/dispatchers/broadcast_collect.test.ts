import { describe, expect, it } from "vitest";

import { BroadcastCollectDispatcher } from "../../src/index.js";
import { buildPlugin } from "../__fixtures__/plugins.js";

describe("BroadcastCollectDispatcher", () => {
  it("calls every plugin and collects results into an array", async () => {
    const d = new BroadcastCollectDispatcher<{ q: string }, string>("tool");
    const a = buildPlugin({ name: "a" }, { search: async (i: { q: string }) => `a:${i.q}` });
    const b = buildPlugin({ name: "b" }, { search: async (i: { q: string }) => `b:${i.q}` });
    const out = await d.dispatch([a, b], "search", { q: "hi" });
    expect(out.sort()).toEqual(["a:hi", "b:hi"]);
  });

  it("returns an empty array when no plugins match the kind", async () => {
    const d = new BroadcastCollectDispatcher("tool");
    expect(await d.dispatch([], "search", null)).toEqual([]);
  });

  it("ignores plugins of a different kind", async () => {
    const d = new BroadcastCollectDispatcher("tool");
    const orch = buildPlugin({ name: "orch", kind: "orchestrator" }, { search: async () => "x" });
    expect(await d.dispatch([orch], "search", null)).toEqual([]);
  });

  it("propagates errors (any failing plugin aborts)", async () => {
    const d = new BroadcastCollectDispatcher("tool");
    const a = buildPlugin({ name: "a" }, { search: async () => "ok" });
    const b = buildPlugin(
      { name: "b" },
      {
        search: async () => {
          throw new Error("boom");
        },
      },
    );
    await expect(d.dispatch([a, b], "search", null)).rejects.toThrow(/boom/);
  });

  it("skips plugins that don't implement the hook", async () => {
    const d = new BroadcastCollectDispatcher("tool");
    const a = buildPlugin({ name: "a" }, { search: async () => "a" });
    const b = buildPlugin({ name: "b" }, {});
    expect(await d.dispatch([a, b], "search", null)).toEqual(["a"]);
  });

  it("handles synchronous return values via Promise.resolve", async () => {
    const d = new BroadcastCollectDispatcher("tool");
    const a = buildPlugin({ name: "a" }, { search: () => "sync" });
    expect(await d.dispatch([a], "search", null)).toEqual(["sync"]);
  });
});
