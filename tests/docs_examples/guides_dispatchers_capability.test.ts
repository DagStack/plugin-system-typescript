// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/guides/dispatchers/capability.mdx`.

import { describe, expect, it } from "vitest";

import { CapabilityDispatcher } from "../../src/index.js";
import { buildPlugin } from "../__fixtures__/plugins.js";

type ChunkPayload = { language?: string; extension?: string; content: string };
type ChunkResult = { chunks: string[] };

describe("capability.mdx — chunker selection by capabilities (TypeScript)", () => {
  it("snippet: dispatcher picks the plugin that declares the required capability", async () => {
    const treesitter = buildPlugin(
      { name: "treesitter", kind: "chunker", capabilities: ["lang:python", "lang:javascript"] },
      {
        chunk: async (p: ChunkPayload): Promise<ChunkResult> => ({
          chunks: [`treesitter:${p.language}:${p.content}`],
        }),
      },
    );
    const fixed = buildPlugin(
      { name: "fixed", kind: "chunker", capabilities: ["any"], fallback: true },
      {
        chunk: async (p: ChunkPayload): Promise<ChunkResult> => ({
          chunks: [`fixed:${p.content}`],
        }),
      },
    );

    const dispatcher = new CapabilityDispatcher<ChunkPayload, ChunkResult>("chunker");
    const result = await dispatcher.dispatch(
      [treesitter, fixed],
      "chunk",
      { language: "python", content: "def hello(): ...", capabilities: { required: ["lang:python"] } },
    );
    expect(result.chunks).toEqual(["treesitter:python:def hello(): ..."]);
  });

  it("snippet: dispatcher falls back to fallback=true when no non-fallback satisfies", async () => {
    const treesitter = buildPlugin(
      { name: "treesitter", kind: "chunker", capabilities: ["lang:python"] },
      { chunk: async (): Promise<ChunkResult> => ({ chunks: ["treesitter"] }) },
    );
    const fixed = buildPlugin(
      { name: "fixed", kind: "chunker", capabilities: ["any"], fallback: true },
      { chunk: async (): Promise<ChunkResult> => ({ chunks: ["fixed"] }) },
    );

    const dispatcher = new CapabilityDispatcher<ChunkPayload, ChunkResult>("chunker");
    const result = await dispatcher.dispatch(
      [treesitter, fixed],
      "chunk",
      { extension: ".md", content: "# hi", capabilities: { required: ["any"] } },
    );
    expect(result.chunks).toEqual(["fixed"]);
  });
});
