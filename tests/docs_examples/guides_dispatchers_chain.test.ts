// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/guides/dispatchers/chain.mdx`.

import { describe, expect, it } from "vitest";

import { ChainDispatcher } from "../../src/index.js";
import { buildPlugin } from "../__fixtures__/plugins.js";

type Query = { text: string; tenantId: string };

describe("chain.mdx — query-rewriter chain (TypeScript)", () => {
  it("snippet: ChainDispatcher threads value through plugins in priority desc", async () => {
    const normalizer = buildPlugin(
      { name: "normalizer", kind: "query_rewriter", priority: 100 },
      {
        rewrite: async (q: Query): Promise<Query> => ({
          ...q,
          text: q.text.trim().toLowerCase().replace(/\s+/g, " "),
        }),
      },
    );
    const synonymizer = buildPlugin(
      { name: "synonymizer", kind: "query_rewriter", priority: 50 },
      {
        rewrite: async (q: Query): Promise<Query> => ({
          ...q,
          text: q.text.replace("launch", "start"),
        }),
      },
    );

    const dispatcher = new ChainDispatcher<Query>("query_rewriter");
    const original: Query = { text: "  How to LAUNCH dagstack?  ", tenantId: "acme-corp" };
    const rewritten = await dispatcher.dispatch(
      [normalizer, synonymizer],
      "rewrite",
      original,
    );
    expect(rewritten.text).toBe("how to start dagstack?");
    expect(rewritten.tenantId).toBe("acme-corp");
  });

  it("snippet: Blacklist plugin aborts the chain by throwing", async () => {
    const blacklist = buildPlugin(
      { name: "blacklist", kind: "query_rewriter", priority: 100 },
      {
        rewrite: (q: Query): Query => {
          const banned = ["delete_database", "rm -rf"];
          if (banned.some((bad) => q.text.toLowerCase().includes(bad))) {
            throw new Error("Query blocked by blacklist");
          }
          return q;
        },
      },
    );
    const downstream = buildPlugin(
      { name: "downstream", kind: "query_rewriter", priority: 50 },
      { rewrite: async (q: Query) => q },
    );

    const dispatcher = new ChainDispatcher<Query>("query_rewriter");
    await expect(
      dispatcher.dispatch(
        [blacklist, downstream],
        "rewrite",
        { text: "rm -rf /", tenantId: "" },
      ),
    ).rejects.toThrow(/blocked by blacklist/);
  });
});
