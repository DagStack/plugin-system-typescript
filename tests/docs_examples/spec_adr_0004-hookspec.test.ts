// Auto-tests for the TypeScript snippets in
// `dagstack-plugin-system-docs/site/docs/spec/adr/0004-hookspec.mdx`.
//
// The TS TabItem on this page shows the **emitted** source for `ToolV1`
// (`plugin-system-typescript/src/_generated/kinds/tool/v1.ts`). The
// canonical expectation is that whatever the docs show is what the package
// re-exports under the `ToolV1` namespace. This test asserts that the
// shipped types match the documented contract.

import { describe, expect, it } from "vitest";

import { ToolV1 } from "../../src/index.js";

describe("spec/adr/0004-hookspec.mdx — emitted ToolV1 (TypeScript)", () => {
  it("snippet: ExecuteInput zod schema accepts the documented shape", () => {
    // --- snippet start (ADR-0004 / ExecuteInput) ----------------------
    const sample = {
      function: "echo",
      args: { msg: "hello" },
    };
    const parsed = ToolV1.ExecuteInputSchema.parse(sample);
    // --- snippet end --------------------------------------------------
    expect(parsed.function).toBe("echo");
    expect(parsed.args).toEqual({ msg: "hello" });
  });

  it("snippet: ExecuteOutput schema validates a successful response", () => {
    // --- snippet start (ADR-0004 / ExecuteOutput) ---------------------
    const sample = {
      result: { echoed: "hello" },
    };
    const parsed = ToolV1.ExecuteOutputSchema.parse(sample);
    // --- snippet end --------------------------------------------------
    expect((parsed.result as { echoed: string }).echoed).toBe("hello");
  });

  it("snippet: GetSchemaOutput schema validates a list of tool descriptors", () => {
    // --- snippet start (ADR-0004 / GetSchemaOutput) -------------------
    const schemas = [
      {
        name: "echo",
        description: "Echo back the input",
        parameters: { type: "object" as const, properties: {} },
      },
    ];
    const parsed = ToolV1.GetSchemaOutputSchema.parse(schemas);
    // --- snippet end --------------------------------------------------
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("echo");
  });

  it("snippet: a class implementing ToolV1.ToolPlugin satisfies the contract", () => {
    // --- snippet start (ADR-0004 / ToolPlugin interface) --------------
    class EchoTool implements ToolV1.ToolPlugin {
      get_schema(_payload: ToolV1.Empty): ToolV1.GetSchemaOutput {
        return [
          {
            name: "echo",
            description: "Echo back the input",
            parameters: { type: "object", properties: {} },
          },
        ];
      }
      execute(input: ToolV1.ExecuteInput): ToolV1.ExecuteOutput {
        return { result: { echoed: (input.args as { msg?: string }).msg ?? "" } };
      }
    }
    // --- snippet end --------------------------------------------------

    const plugin = new EchoTool();
    expect(plugin.get_schema({})).toHaveLength(1);
    const result = plugin.execute({ function: "echo", args: { msg: "hi" } });
    expect((result.result as { echoed: string }).echoed).toBe("hi");
  });

  it("kind metadata constants line up with the spec", () => {
    expect(ToolV1.KIND_NAME).toBe("tool");
    expect(typeof ToolV1.KIND_API_VERSION).toBe("string");
    expect(ToolV1.HOOK_DISPATCH).toBeDefined();
    expect(ToolV1.HOOK_MCP_EXPOSED).toBeDefined();
  });
});
