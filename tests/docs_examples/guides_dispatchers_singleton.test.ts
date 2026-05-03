// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/guides/dispatchers/singleton.mdx`.

import { describe, expect, it } from "vitest";

import { SingletonDispatcher } from "../../src/index.js";
import { buildPlugin } from "../__fixtures__/plugins.js";

describe("singleton.mdx — Step 4. The call (TypeScript)", () => {
  it("snippet: SingletonDispatcher routes to the highest-priority match", async () => {
    type ChargeInput = { amountCents: number; currency: string; source: string };
    type ChargeOutput = { transactionId: string };

    const stripe = buildPlugin(
      { name: "stripe", kind: "payment_provider", priority: 50 },
      { charge: async (_: ChargeInput): Promise<ChargeOutput> => ({ transactionId: "tx_stripe_1" }) },
    );
    const internal = buildPlugin(
      { name: "internal", kind: "payment_provider", priority: 40 },
      { charge: async (_: ChargeInput): Promise<ChargeOutput> => ({ transactionId: "tx_internal_1" }) },
    );

    const payment = new SingletonDispatcher<ChargeInput, ChargeOutput>("payment_provider");
    const result = await payment.dispatch(
      [stripe, internal],
      "charge",
      { amountCents: 1999, currency: "USD", source: "tok_visa" },
    );
    expect(result.transactionId).toBe("tx_stripe_1");
  });
});
