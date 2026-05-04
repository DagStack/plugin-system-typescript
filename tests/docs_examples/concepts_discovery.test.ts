// Mirror of TypeScript snippets in
// `dagstack-plugin-system-docs/site/docs/concepts/discovery.mdx`.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discover, PluginRegistry } from "../../src/index.js";

describe("concepts/discovery.mdx — TypeScript", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "dagstack-concepts-discovery-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("snippet: discover walks plugins directory and reports failures", async () => {
    await mkdir(join(tmp, "echo"), { recursive: true });
    await writeFile(
      join(tmp, "echo", "dagstack.json"),
      JSON.stringify({
        plugin: {
          schema_version: "1.0.0",
          name: "echo",
          kind: "tool",
          kind_api_version: "1.0.0",
          core_version: "^0.2.0",
          runtime: "in_process",
          entry_point: "./plugin.js#EchoPlugin",
        },
      }),
    );

    const registry = new PluginRegistry();
    const result = await discover(registry, tmp);
    expect(result.failures).toHaveLength(0);
    expect(result.registered.map((m) => m.name)).toEqual(["echo"]);
  });
});
