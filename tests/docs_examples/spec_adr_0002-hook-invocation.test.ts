// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/spec/adr/0002-hook-invocation.mdx`.

import { describe, expect, it } from "vitest";

import { SingletonDispatcher } from "../../src/index.js";
import { buildPlugin } from "../__fixtures__/plugins.js";

describe("spec/adr/0002-hook-invocation.mdx — TypeScript", () => {
  it("snippet: SingletonDispatcher.dispatch with priority tie-breaking", async () => {
    const stripe = buildPlugin(
      { name: "stripe", kind: "payment_provider", priority: 50 },
      { charge: async (_: unknown) => ({ transactionId: "tx-stripe" }) },
    );
    const internal = buildPlugin(
      { name: "internal", kind: "payment_provider", priority: 40 },
      { charge: async (_: unknown) => ({ transactionId: "tx-internal" }) },
    );

    const dispatcher = new SingletonDispatcher("payment_provider");
    const result = await dispatcher.dispatch(
      [stripe, internal],
      "charge",
      { amountCents: 1999, currency: "USD" },
    );
    expect((result as { transactionId: string }).transactionId).toBe("tx-stripe");
  });
});
