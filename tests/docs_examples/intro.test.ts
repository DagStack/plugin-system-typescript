// Auto-tests for the TypeScript snippets in
// `dagstack-plugin-system-docs/site/docs/intro.mdx`.
//
// Phase 1 runtime snippets (TS-1..TS-4 — `PluginRegistry`, `discover`,
// dispatchers, lifecycle) replaced the previous "ships in Phase 1"
// admonitions. The first three describe blocks below cover the
// spec-emitted types surface (still relevant); the remaining three
// cover the runtime snippets verbatim.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  discover,
  OrchestratorV1,
  PluginRegistry,
  SingletonDispatcher,
  ToolV1,
  VERSION,
} from "../../src/index.js";

describe("intro.mdx — VERSION + spec-emitted types (TypeScript)", () => {
  it("snippet: VERSION is a non-empty string at the package root", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it("snippet: ToolV1 namespace exposes KIND_NAME, schemas, and the plugin interface", () => {
    expect(ToolV1.KIND_NAME).toBe("tool");
    expect(typeof ToolV1.KIND_API_VERSION).toBe("string");
    expect(ToolV1.ExecuteInputSchema).toBeDefined();
    expect(ToolV1.ExecuteOutputSchema).toBeDefined();
    expect(ToolV1.GetSchemaOutputSchema).toBeDefined();
    expect(ToolV1.HOOK_DISPATCH).toBeDefined();
    expect(ToolV1.HOOK_MCP_EXPOSED).toBeDefined();
  });

  it("snippet: OrchestratorV1 namespace exposes its KIND_NAME and schemas", () => {
    expect(OrchestratorV1.KIND_NAME).toBe("orchestrator");
    expect(typeof OrchestratorV1.KIND_API_VERSION).toBe("string");
    expect(OrchestratorV1.EnqueueInputSchema).toBeDefined();
    expect(OrchestratorV1.EnqueueOutputSchema).toBeDefined();
  });
});

describe("intro.mdx — implementing ToolV1.ToolPlugin contract (TypeScript)", () => {
  it("snippet: a class implementing ToolV1.ToolPlugin satisfies the contract", () => {
    class MyTool implements ToolV1.ToolPlugin {
      get_schema(_payload: ToolV1.Empty): ToolV1.GetSchemaOutput {
        return [
          {
            name: "echo",
            description: "Echo back the input",
            parameters: {
              type: "object",
              properties: { msg: { type: "string" } },
            },
          },
        ];
      }

      execute(payload: ToolV1.ExecuteInput): ToolV1.ExecuteOutput {
        return { result: { echoed: (payload.args as { msg?: string }).msg ?? "" } };
      }
    }
    const tool = new MyTool();
    const schemaList = tool.get_schema({});
    const parsedSchemas = ToolV1.GetSchemaOutputSchema.parse(schemaList);
    expect(parsedSchemas).toHaveLength(1);
    expect(parsedSchemas[0].name).toBe("echo");

    const result = tool.execute({ function: "echo", args: { msg: "hi" } });
    const parsedResult = ToolV1.ExecuteOutputSchema.parse(result);
    expect((parsedResult.result as { echoed: string }).echoed).toBe("hi");
  });
});

// Phase 1 runtime snippets — verbatim mirror of the new TS TabItems in
// `intro.mdx`. The host wraps them in a temp directory so dynamic
// import works against a real filesystem (matching the manifest format
// shown in the docs).

describe("intro.mdx — Phase 1 runtime snippets (TypeScript)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "dagstack-intro-"));
    await mkdir(join(tmp, "echo"), { recursive: true });
    // Snippet 1: dagstack.json manifest.
    const manifest = {
      plugin: {
        schema_version: "1.0.0",
        name: "echo",
        kind: "tool",
        kind_api_version: "1.0.0",
        core_version: "^0.2.0",
        runtime: "in_process",
        license: "Apache-2.0",
        entry_point: "./plugin.mjs#EchoPlugin",
      },
    };
    await writeFile(join(tmp, "echo", "dagstack.json"), JSON.stringify(manifest, null, 2));
    // Snippet 1 (cont.): plugin.ts compiled to ESM.
    const plugin = `
export class EchoPlugin {
  ctx;
  async setup(ctx) { this.ctx = ctx; }
  async execute(args) { return { echoed: args.msg }; }
  async teardown() { this.ctx = undefined; }
}
`;
    await writeFile(join(tmp, "echo", "plugin.mjs"), plugin);
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("snippet 2: discover + setupAll + list + teardownAll", async () => {
    // --- snippet start (intro / discover and load) -----------------------
    const registry = new PluginRegistry();
    await discover(registry, tmp);
    await registry.setupAll();

    const names: string[] = [];
    for (const manifest of registry.list()) {
      names.push(`${manifest.kind}:${manifest.name}`);
    }

    await registry.teardownAll();
    // --- snippet end -----------------------------------------------------
    expect(names).toEqual(["tool:echo"]);
  });

  it("snippet 3: SingletonDispatcher.dispatch over getLoadedPlugins", async () => {
    const registry = new PluginRegistry();
    await discover(registry, tmp);
    await registry.setupAll();

    // --- snippet start (intro / calling) ---------------------------------
    const dispatcher = new SingletonDispatcher<{ msg: string }, { echoed: string }>("tool");
    const result = await dispatcher.dispatch(
      registry.getLoadedPlugins(),
      "execute",
      { msg: "hello" },
    );
    // --- snippet end -----------------------------------------------------

    expect(result).toEqual({ echoed: "hello" });

    await registry.teardownAll();
  });
});
