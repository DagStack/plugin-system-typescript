// Mirror of TypeScript snippets in
// `dagstack-plugin-system-docs/site/docs/concepts/kinds.mdx`.

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { PluginRegistry } from "../../src/index.js";

describe("concepts/kinds.mdx — TypeScript", () => {
  it("snippet 1: emitted zod schemas + interface for a custom kind", () => {
    const CompleteInputSchema = z
      .object({
        prompt: z.string(),
        temperature: z.number().min(0).max(2),
        max_tokens: z.number().int().positive().optional(),
      })
      .strict();

    const CompleteOutputSchema = z
      .object({
        text: z.string(),
        tokens_used: z.number().int().nonnegative(),
      })
      .strict();

    type CompleteInput = z.infer<typeof CompleteInputSchema>;
    type CompleteOutput = z.infer<typeof CompleteOutputSchema>;

    interface LLMPlugin {
      complete(input: CompleteInput): Promise<CompleteOutput>;
    }

    class FakeLLM implements LLMPlugin {
      async complete(input: CompleteInput): Promise<CompleteOutput> {
        return { text: `echo: ${input.prompt}`, tokens_used: input.prompt.length };
      }
    }

    const validInput = CompleteInputSchema.parse({ prompt: "hi", temperature: 0.7 });
    const llm = new FakeLLM();
    return llm.complete(validInput).then((out) => {
      const validOutput = CompleteOutputSchema.parse(out);
      expect(validOutput.text).toBe("echo: hi");
      expect(validOutput.tokens_used).toBe(2);
    });
  });

  it("snippet 2: structural typing instead of pluggy hookspec", () => {
    interface LLMPlugin {
      complete(input: { prompt: string }): Promise<{ text: string }>;
    }

    const registry = new PluginRegistry();
    void (null as unknown as LLMPlugin); // emitted-types reference, no runtime side-effect
    expect(registry.list()).toHaveLength(0);
  });
});
