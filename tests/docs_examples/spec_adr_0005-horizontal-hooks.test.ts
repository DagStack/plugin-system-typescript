// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/spec/adr/0005-horizontal-hooks.mdx`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BroadcastNotifyDispatcher, ChainDispatcher } from "../../src/index.js";
import { buildPlugin } from "../__fixtures__/plugins.js";

type Request = { id: string; path: string };

describe("spec/adr/0005-horizontal-hooks.mdx — TypeScript", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("snippet: chain rewrite + broadcast notify on lifecycle", async () => {
    const rewriter = buildPlugin(
      { name: "rewriter", kind: "request_rewriter" },
      { rewrite: async (r: Request): Promise<Request> => ({ ...r, path: `/v2${r.path}` }) },
    );
    const listener = buildPlugin(
      { name: "metrics", kind: "lifecycle_listener" },
      {
        onRequestStarted: (_event: { requestId: string; path: string }) => {
          /* fire-and-forget */
        },
      },
    );

    const requestRewriters = new ChainDispatcher<Request>("request_rewriter");
    const lifecycleListeners = new BroadcastNotifyDispatcher("lifecycle_listener");

    const rewritten = await requestRewriters.dispatch(
      [rewriter],
      "rewrite",
      { id: "r-1", path: "/api/x" },
    );
    expect(rewritten.path).toBe("/v2/api/x");

    const result = await lifecycleListeners.dispatch(
      [listener],
      "onRequestStarted",
      { requestId: rewritten.id, path: rewritten.path },
    );
    expect(result.delivered).toBe(1);
    expect(result.failed).toEqual([]);
  });
});
