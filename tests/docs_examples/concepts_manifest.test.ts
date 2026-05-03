// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/concepts/manifest.mdx` — Validation section.

import { describe, expect, it } from "vitest";

import { ManifestInvalid, PluginManifestSchema, PluginRegistry } from "../../src/index.js";

const validRaw = {
  schema_version: "1.0.0",
  name: "echo",
  kind: "tool",
  kind_api_version: "1.0.0",
  core_version: "^0.2.0",
  runtime: "in_process",
  entry_point: "./plugin.js#EchoPlugin",
};

describe("concepts/manifest.mdx — Validation (TypeScript)", () => {
  it("snippet 1: zod schema parse for raw manifest dict", () => {
    const parsed = PluginManifestSchema.parse(validRaw);
    expect(parsed.name).toBe("echo");
    expect(parsed.priority).toBe(0); // default applied
  });

  it("snippet 1: auto-unwrap of [plugin] section", () => {
    const wrapped = { plugin: validRaw };
    const innerParsed = PluginManifestSchema.parse(
      "plugin" in wrapped ? wrapped.plugin : wrapped,
    );
    expect(innerParsed.name).toBe("echo");
  });

  it("snippet 2: registerManifest validates and throws ManifestInvalid", () => {
    const registry = new PluginRegistry();
    expect(() => registry.registerManifest({ name: "no-fields" })).toThrowError(
      ManifestInvalid,
    );
    const manifest = registry.registerManifest(validRaw, "file:my-plugin/dagstack.json");
    expect(manifest.name).toBe("echo");
  });
});
