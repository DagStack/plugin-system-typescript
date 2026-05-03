import { describe, expect, it } from "vitest";

import { PluginManifestSchema } from "../src/manifest.js";

const baseManifest = {
  schema_version: "1.0.0",
  name: "echo",
  kind: "tool",
  kind_api_version: "1.0.0",
  core_version: "^0.2.0",
  runtime: "in_process",
  entry_point: "src/plugin.js#EchoPlugin",
} as const;

describe("PluginManifestSchema", () => {
  it("accepts a minimal valid manifest and applies defaults", () => {
    const result = PluginManifestSchema.parse(baseManifest);
    expect(result.priority).toBe(0);
    expect(result.tryfirst).toBe(false);
    expect(result.execution_model).toBe("sync");
    expect(result.startup_timeout_sec).toBe(30);
  });

  it("rejects manifests missing a required field", () => {
    const { name: _name, ...rest } = baseManifest;
    const result = PluginManifestSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("name"))).toBe(true);
    }
  });

  it("rejects unknown top-level fields (.strict)", () => {
    const result = PluginManifestSchema.safeParse({ ...baseManifest, foo: 1 });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = PluginManifestSchema.safeParse({ ...baseManifest, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects when both tryfirst and trylast are true", () => {
    const result = PluginManifestSchema.safeParse({
      ...baseManifest,
      tryfirst: true,
      trylast: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("cannot both be true"))).toBe(true);
    }
  });

  it("rejects negative priority", () => {
    const result = PluginManifestSchema.safeParse({ ...baseManifest, priority: -1 });
    expect(result.success).toBe(false);
  });

  it("requires entry_point when runtime=in_process", () => {
    const { entry_point: _ep, ...rest } = baseManifest;
    const result = PluginManifestSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("entry_point is required"))).toBe(
        true,
      );
    }
  });

  it("requires command when runtime=mcp_stdio", () => {
    const result = PluginManifestSchema.safeParse({
      ...baseManifest,
      runtime: "mcp_stdio",
      entry_point: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("command"))).toBe(true);
    }
  });

  it("requires url when runtime=mcp_http", () => {
    const result = PluginManifestSchema.safeParse({
      ...baseManifest,
      runtime: "mcp_http",
      entry_point: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("url"))).toBe(true);
    }
  });

  it("rejects invalid runtime enum values", () => {
    const result = PluginManifestSchema.safeParse({ ...baseManifest, runtime: "lambda" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid execution_model enum values", () => {
    const result = PluginManifestSchema.safeParse({
      ...baseManifest,
      execution_model: "fiber",
    });
    expect(result.success).toBe(false);
  });

  it("accepts depends_on, capabilities, resources block", () => {
    const result = PluginManifestSchema.parse({
      ...baseManifest,
      depends_on: ["other"],
      capabilities: ["math"],
      resources: { required: ["http_client"] },
    });
    expect(result.depends_on).toEqual(["other"]);
    expect(result.capabilities).toEqual(["math"]);
    expect(result.resources?.required).toEqual(["http_client"]);
  });

  it("rejects negative startup_timeout_sec", () => {
    const result = PluginManifestSchema.safeParse({
      ...baseManifest,
      startup_timeout_sec: -1,
    });
    expect(result.success).toBe(false);
  });
});
