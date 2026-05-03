// Mirror of TypeScript snippets in
// `dagstack-plugin-system-docs/site/docs/concepts/dispatch.mdx`.
//
// Tests the constructor surface for all five dispatch classes (per-class
// dispatch behaviour is covered in detail by guides_dispatchers_*.test.ts).

import { describe, expect, it } from "vitest";

import {
  BroadcastCollectDispatcher,
  BroadcastNotifyDispatcher,
  CapabilityDispatcher,
  ChainDispatcher,
  SingletonDispatcher,
} from "../../src/index.js";

describe("concepts/dispatch.mdx — TypeScript", () => {
  it("snippet: all five dispatcher classes are constructable and tagged", () => {
    const singleton = new SingletonDispatcher("llm");
    const broadcastCollect = new BroadcastCollectDispatcher("tool_provider");
    const broadcastNotify = new BroadcastNotifyDispatcher("lifecycle_listener");
    const chain = new ChainDispatcher("query_rewriter");
    const capability = new CapabilityDispatcher("chunker");

    expect(singleton.dispatchClass).toBe("singleton");
    expect(broadcastCollect.dispatchClass).toBe("broadcast_collect");
    expect(broadcastNotify.dispatchClass).toBe("broadcast_notify");
    expect(chain.dispatchClass).toBe("chain");
    expect(capability.dispatchClass).toBe("capability");
  });
});
