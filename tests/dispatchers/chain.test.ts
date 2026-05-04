import { describe, expect, it } from "vitest";

import { ChainDispatcher, STOP_CHAIN } from "../../src/index.js";
import { buildPlugin } from "../__fixtures__/plugins.js";

describe("ChainDispatcher", () => {
  it("threads input through plugins in priority desc order", async () => {
    const d = new ChainDispatcher<number>("tool");
    const a = buildPlugin(
      { name: "a", priority: 50 },
      { transform: async (x: number) => x + 1 },
    );
    const b = buildPlugin(
      { name: "b", priority: 10 },
      { transform: async (x: number) => x * 2 },
    );
    // priority 50 first → +1, then priority 10 → *2.
    expect(await d.dispatch([a, b], "transform", 1)).toBe((1 + 1) * 2);
  });

  it("respects tryfirst (runs before normal regardless of priority)", async () => {
    const d = new ChainDispatcher<number>("tool");
    const high = buildPlugin(
      { name: "high", priority: 100 },
      { transform: async (x: number) => x + 1 },
    );
    const first = buildPlugin(
      { name: "first", priority: 1, tryfirst: true },
      { transform: async (x: number) => x * 10 },
    );
    // first runs first (×10 → 10), then high (+1 → 11).
    expect(await d.dispatch([high, first], "transform", 1)).toBe(11);
  });

  it("respects trylast (runs after normal regardless of priority)", async () => {
    const d = new ChainDispatcher<number>("tool");
    const high = buildPlugin(
      { name: "high", priority: 100 },
      { transform: async (x: number) => x + 1 },
    );
    const last = buildPlugin(
      { name: "last", priority: 99, trylast: true },
      { transform: async (x: number) => x * 10 },
    );
    // high first (+1 → 2), then last (×10 → 20).
    expect(await d.dispatch([high, last], "transform", 1)).toBe(20);
  });

  it("returns input unchanged when no plugins match the kind", async () => {
    const d = new ChainDispatcher<string>("tool");
    expect(await d.dispatch([], "transform", "x")).toBe("x");
  });

  it("propagates errors from the failing plugin and aborts the chain", async () => {
    const d = new ChainDispatcher<string>("tool");
    let bCalled = false;
    const a = buildPlugin(
      { name: "a", priority: 50 },
      {
        transform: async () => {
          throw new Error("kaboom");
        },
      },
    );
    const b = buildPlugin(
      { name: "b", priority: 10 },
      {
        transform: async (x: string) => {
          bCalled = true;
          return x;
        },
      },
    );
    await expect(d.dispatch([a, b], "transform", "in")).rejects.toThrow(/kaboom/);
    expect(bCalled).toBe(false);
  });

  it("ties on priority resolved by registration order (a before b)", async () => {
    const d = new ChainDispatcher<string>("tool");
    const a = buildPlugin({ name: "a", priority: 50 }, { transform: async (s: string) => s + "A" });
    const b = buildPlugin({ name: "b", priority: 50 }, { transform: async (s: string) => s + "B" });
    expect(await d.dispatch([a, b], "transform", "")).toBe("AB");
  });

  it("skips plugins that don't implement the hook", async () => {
    const d = new ChainDispatcher<number>("tool");
    const a = buildPlugin({ name: "a", priority: 50 }, { transform: async (x: number) => x + 1 });
    const b = buildPlugin({ name: "b", priority: 10 }, {});
    expect(await d.dispatch([a, b], "transform", 1)).toBe(2);
  });

  it("STOP_CHAIN sentinel short-circuits the chain (cross-binding parity with Python)", async () => {
    const d = new ChainDispatcher<number>("tool");
    let downstreamCalled = false;
    const stopper = buildPlugin(
      { name: "stopper", priority: 50 },
      { transform: () => STOP_CHAIN },
    );
    const downstream = buildPlugin(
      { name: "downstream", priority: 10 },
      {
        transform: async (x: number) => {
          downstreamCalled = true;
          return x + 100;
        },
      },
    );
    // Chain receives 5, stopper short-circuits → final value is the
    // input that came _into_ stopper (5).
    expect(await d.dispatch([stopper, downstream], "transform", 5)).toBe(5);
    expect(downstreamCalled).toBe(false);
  });
});
