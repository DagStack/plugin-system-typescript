// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/guides/dispatchers/broadcast-collect.mdx`.

import { describe, expect, it } from "vitest";

import { BroadcastCollectDispatcher } from "../../src/index.js";
import { buildPlugin } from "../__fixtures__/plugins.js";

describe("broadcast-collect.mdx — collect tools (TypeScript)", () => {
  it("snippet: every plugin contributes a list, results flatten", async () => {
    type ToolDef = { name: string; description: string };

    const filesystem = buildPlugin(
      { name: "filesystem", kind: "tool_provider", priority: 50 },
      {
        list_tools: async (): Promise<ToolDef[]> => [
          { name: "read_file", description: "Read a file" },
          { name: "write_file", description: "Write a file" },
        ],
      },
    );
    const web = buildPlugin(
      { name: "web", kind: "tool_provider", priority: 40 },
      {
        list_tools: async (): Promise<ToolDef[]> => [
          { name: "http_get", description: "HTTP GET" },
          { name: "search", description: "Web search" },
        ],
      },
    );

    const dispatcher = new BroadcastCollectDispatcher<unknown, ToolDef[]>("tool_provider");
    const toolsLists = await dispatcher.dispatch(
      [filesystem, web],
      "list_tools",
      null,
    );
    const allTools = toolsLists.flat();
    expect(allTools.map((t) => t.name)).toEqual([
      "read_file",
      "write_file",
      "http_get",
      "search",
    ]);
  });
});
