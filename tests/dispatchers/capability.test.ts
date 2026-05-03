import { describe, expect, it } from "vitest";

import { AmbiguousPlugin, CapabilityDispatcher, KindUnknown } from "../../src/index.js";
import { buildPlugin } from "../__fixtures__/plugins.js";

describe("CapabilityDispatcher", () => {
  it("picks the only plugin satisfying required capabilities", async () => {
    const d = new CapabilityDispatcher<{ q: string }, string>("tool");
    const cn = buildPlugin(
      { name: "cn", capabilities: ["chinese"] },
      { search: async (i: { q: string }) => `cn:${i.q}` },
    );
    const en = buildPlugin(
      { name: "en", capabilities: ["english"] },
      { search: async (i: { q: string }) => `en:${i.q}` },
    );
    const result = await d.dispatch([cn, en], "search", {
      q: "hi",
      capabilities: { required: ["chinese"] },
    });
    expect(result).toBe("cn:hi");
  });

  it("picks highest priority among satisfying candidates", async () => {
    const d = new CapabilityDispatcher<{ q: string }, string>("tool");
    const lo = buildPlugin(
      { name: "lo", capabilities: ["english"], priority: 10 },
      { search: async () => "lo" },
    );
    const hi = buildPlugin(
      { name: "hi", capabilities: ["english"], priority: 50 },
      { search: async () => "hi" },
    );
    const result = await d.dispatch([lo, hi], "search", {
      q: "x",
      capabilities: { required: ["english"] },
    });
    expect(result).toBe("hi");
  });

  it("falls back to fallback=true plugin if no non-fallback satisfies", async () => {
    const d = new CapabilityDispatcher<{ q: string }, string>("tool");
    const fb = buildPlugin(
      { name: "fb", capabilities: ["english"], fallback: true },
      { search: async () => "fallback" },
    );
    const cn = buildPlugin(
      { name: "cn", capabilities: ["chinese"], fallback: false },
      { search: async () => "cn" },
    );
    // Required: english. Only fb satisfies and is fallback, cn does not satisfy.
    const result = await d.dispatch([fb, cn], "search", {
      q: "x",
      capabilities: { required: ["english"] },
    });
    expect(result).toBe("fallback");
  });

  it("prefers non-fallback over fallback when both satisfy", async () => {
    const d = new CapabilityDispatcher<{ q: string }, string>("tool");
    const fb = buildPlugin(
      { name: "fb", capabilities: ["english"], fallback: true, priority: 100 },
      { search: async () => "fallback" },
    );
    const main = buildPlugin(
      { name: "main", capabilities: ["english"], priority: 1 },
      { search: async () => "main" },
    );
    const result = await d.dispatch([fb, main], "search", {
      q: "x",
      capabilities: { required: ["english"] },
    });
    expect(result).toBe("main");
  });

  it("throws KindUnknown when no plugin satisfies", async () => {
    const d = new CapabilityDispatcher("tool");
    const en = buildPlugin({ name: "en", capabilities: ["english"] }, { search: async () => 1 });
    await expect(
      d.dispatch([en], "search", { q: "x", capabilities: { required: ["chinese"] } }),
    ).rejects.toThrowError(KindUnknown);
  });

  it("throws AmbiguousPlugin on tie at max priority", async () => {
    const d = new CapabilityDispatcher("tool");
    const a = buildPlugin(
      { name: "a", capabilities: ["x"], priority: 50 },
      { search: async () => 1 },
    );
    const b = buildPlugin(
      { name: "b", capabilities: ["x"], priority: 50 },
      { search: async () => 2 },
    );
    await expect(
      d.dispatch([a, b], "search", { q: "z", capabilities: { required: ["x"] } }),
    ).rejects.toThrowError(AmbiguousPlugin);
  });

  it("works without capabilities requirement (all plugins are candidates)", async () => {
    const d = new CapabilityDispatcher<{ q: string }, string>("tool");
    const a = buildPlugin(
      { name: "a", priority: 10 },
      { search: async () => "a" },
    );
    const b = buildPlugin(
      { name: "b", priority: 50 },
      { search: async () => "b" },
    );
    const result = await d.dispatch([a, b], "search", { q: "x" });
    expect(result).toBe("b");
  });
});
