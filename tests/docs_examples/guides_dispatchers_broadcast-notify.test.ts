// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/guides/dispatchers/broadcast-notify.mdx`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BroadcastNotifyDispatcher } from "../../src/index.js";
import { buildPlugin } from "../__fixtures__/plugins.js";

describe("broadcast-notify.mdx — fire-and-forget event publishing (TypeScript)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("snippet: BroadcastNotifyDispatcher delivers to every plugin and survives a thrown listener", async () => {
    const events: string[] = [];
    const metrics = buildPlugin(
      { name: "metrics", kind: "lifecycle_listener" },
      {
        onRequestStarted: (e: { requestId: string }) => {
          events.push(`metrics:${e.requestId}`);
        },
      },
    );
    const audit = buildPlugin(
      { name: "audit", kind: "lifecycle_listener" },
      {
        onRequestStarted: (e: { requestId: string }) => {
          events.push(`audit:${e.requestId}`);
        },
      },
    );
    const broken = buildPlugin(
      { name: "broken", kind: "lifecycle_listener" },
      {
        onRequestStarted: () => {
          throw new Error("downstream broken");
        },
      },
    );

    const notifier = new BroadcastNotifyDispatcher("lifecycle_listener");
    const result = await notifier.dispatch(
      [metrics, audit, broken],
      "onRequestStarted",
      { requestId: "req-1", path: "/api/x", actor: "alice" },
    );
    expect(result.delivered).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].name).toBe("broken");
    expect(events.sort()).toEqual(["audit:req-1", "metrics:req-1"]);
  });
});
