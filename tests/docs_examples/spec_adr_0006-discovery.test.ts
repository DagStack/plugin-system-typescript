// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/spec/adr/0006-discovery.mdx`.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discover, PluginRegistry } from "../../src/index.js";

describe("spec/adr/0006-discovery.mdx — TypeScript", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "dagstack-adr-0006-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("snippet: discover with explicit ignore list and result.failures", async () => {
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
    // node_modules has a manifest that should be skipped via default ignore.
    await mkdir(join(tmp, "node_modules", "fake"), { recursive: true });
    await writeFile(
      join(tmp, "node_modules", "fake", "dagstack.json"),
      JSON.stringify({
        plugin: {
          schema_version: "1.0.0",
          name: "fake",
          kind: "tool",
          kind_api_version: "1.0.0",
          core_version: "^0.2.0",
          runtime: "in_process",
          entry_point: "./plugin.js#Fake",
        },
      }),
    );

    const registry = new PluginRegistry();
    const result = await discover(registry, tmp, {
      ignore: ["node_modules", ".git", "dist", "build"],
    });
    expect(result.registered.map((m) => m.name)).toEqual(["echo"]);
    expect(result.failures).toEqual([]);
  });
});
