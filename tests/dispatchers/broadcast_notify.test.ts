import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BroadcastNotifyDispatcher } from "../../src/index.js";
import { buildPlugin } from "../__fixtures__/plugins.js";

describe("BroadcastNotifyDispatcher", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("delivers to every plugin and reports counts", async () => {
    const d = new BroadcastNotifyDispatcher("tool");
    let aCalled = false;
    let bCalled = false;
    const a = buildPlugin(
      { name: "a" },
      {
        emit: async () => {
          aCalled = true;
        },
      },
    );
    const b = buildPlugin(
      { name: "b" },
      {
        emit: async () => {
          bCalled = true;
        },
      },
    );
    const result = await d.dispatch([a, b], "emit", { id: 42 });
    expect(aCalled).toBe(true);
    expect(bCalled).toBe(true);
    expect(result.delivered).toBe(2);
    expect(result.failed).toEqual([]);
  });

  it("swallows errors and reports them in failed[]", async () => {
    const d = new BroadcastNotifyDispatcher("tool");
    const a = buildPlugin({ name: "a" }, { emit: async () => {} });
    const b = buildPlugin(
      { name: "broken" },
      {
        emit: async () => {
          throw new Error("downstream error");
        },
      },
    );
    const result = await d.dispatch([a, b], "emit", null);
    expect(result.delivered).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].name).toBe("broken");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("returns delivered=0 when no plugin matches", async () => {
    const d = new BroadcastNotifyDispatcher("tool");
    const result = await d.dispatch([], "emit", null);
    expect(result.delivered).toBe(0);
    expect(result.failed).toEqual([]);
  });

  it("skips plugins that don't implement the hook (counted neither delivered nor failed)", async () => {
    const d = new BroadcastNotifyDispatcher("tool");
    const a = buildPlugin({ name: "a" }, {});
    const b = buildPlugin({ name: "b" }, { emit: async () => {} });
    const result = await d.dispatch([a, b], "emit", null);
    expect(result.delivered).toBe(1);
    expect(result.failed).toHaveLength(0);
  });

  it("does not throw even if every plugin fails", async () => {
    const d = new BroadcastNotifyDispatcher("tool");
    const a = buildPlugin(
      { name: "a" },
      {
        emit: async () => {
          throw new Error("a");
        },
      },
    );
    const b = buildPlugin(
      { name: "b" },
      {
        emit: async () => {
          throw new Error("b");
        },
      },
    );
    const result = await d.dispatch([a, b], "emit", null);
    expect(result.delivered).toBe(0);
    expect(result.failed).toHaveLength(2);
  });

  it("delivers in parallel (Promise.allSettled)", async () => {
    const d = new BroadcastNotifyDispatcher("tool");
    const ts: number[] = [];
    const slow = buildPlugin(
      { name: "slow" },
      {
        emit: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          ts.push(1);
        },
      },
    );
    const fast = buildPlugin(
      { name: "fast" },
      {
        emit: async () => {
          ts.push(2);
        },
      },
    );
    await d.dispatch([slow, fast], "emit", null);
    // fast should land before slow because they ran concurrently.
    expect(ts).toEqual([2, 1]);
  });
});
