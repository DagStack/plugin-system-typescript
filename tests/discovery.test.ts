import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { discover, PluginRegistry } from "../src/index.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "dagstack-discover-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

const validManifestObject = (overrides: Record<string, unknown> = {}) => ({
  schema_version: "1.0.0",
  name: "echo",
  kind: "tool",
  kind_api_version: "1.0.0",
  core_version: "^0.2.0",
  runtime: "in_process",
  entry_point: "./plugin.js#EchoPlugin",
  ...overrides,
});

async function writeJSON(dir: string, manifest: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "dagstack.json"), JSON.stringify(manifest, null, 2));
}

async function writeTOML(dir: string, body: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "dagstack.toml"), body);
}

describe("discover", () => {
  it("registers a JSON manifest at top level", async () => {
    await writeJSON(join(tmpRoot, "echo"), validManifestObject());
    const registry = new PluginRegistry();
    const result = await discover(registry, tmpRoot);
    expect(result.registered).toHaveLength(1);
    expect(result.registered[0].name).toBe("echo");
    expect(result.failures).toHaveLength(0);
  });

  it("registers a TOML manifest with a [plugin] section", async () => {
    const toml = `
[plugin]
schema_version = "1.0.0"
name = "echo-toml"
kind = "tool"
kind_api_version = "1.0.0"
core_version = "^0.2.0"
runtime = "in_process"
entry_point = "./plugin.js#EchoPlugin"
`;
    await writeTOML(join(tmpRoot, "echo"), toml);
    const registry = new PluginRegistry();
    const result = await discover(registry, tmpRoot);
    expect(result.registered).toHaveLength(1);
    expect(result.registered[0].name).toBe("echo-toml");
  });

  it("walks nested directories", async () => {
    await writeJSON(join(tmpRoot, "tier-a", "alpha"), validManifestObject({ name: "alpha" }));
    await writeJSON(
      join(tmpRoot, "tier-a", "beta"),
      validManifestObject({ name: "beta", priority: 5 }),
    );
    await writeJSON(
      join(tmpRoot, "tier-b", "gamma"),
      validManifestObject({ name: "gamma", priority: 10 }),
    );
    const registry = new PluginRegistry();
    const result = await discover(registry, tmpRoot);
    expect(result.registered.map((m) => m.name).sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("skips DEFAULT_IGNORE directories", async () => {
    await writeJSON(join(tmpRoot, "node_modules", "lib"), validManifestObject({ name: "lib" }));
    await writeJSON(join(tmpRoot, "real"), validManifestObject({ name: "real" }));
    const registry = new PluginRegistry();
    const result = await discover(registry, tmpRoot);
    expect(result.registered.map((m) => m.name)).toEqual(["real"]);
  });

  it("supports custom ignore patterns (glob)", async () => {
    await writeJSON(join(tmpRoot, "experimental"), validManifestObject({ name: "exp" }));
    await writeJSON(join(tmpRoot, "real"), validManifestObject({ name: "real" }));
    const registry = new PluginRegistry();
    const result = await discover(registry, tmpRoot, { ignore: ["exp*"] });
    expect(result.registered.map((m) => m.name)).toEqual(["real"]);
  });

  it("continue-on-failure: a broken manifest does not block others", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await mkdir(join(tmpRoot, "broken"), { recursive: true });
      await writeFile(join(tmpRoot, "broken", "dagstack.json"), "{ not valid json");
      await writeJSON(join(tmpRoot, "good"), validManifestObject({ name: "good" }));
      const registry = new PluginRegistry();
      const result = await discover(registry, tmpRoot);
      expect(result.registered.map((m) => m.name)).toEqual(["good"]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].path).toContain("broken");
      expect(result.failures[0].reason).toContain("invalid JSON");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("reports validation failures (schema violation)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeJSON(join(tmpRoot, "bad"), { name: "no-required-fields" });
      const registry = new PluginRegistry();
      const result = await discover(registry, tmpRoot);
      expect(result.registered).toHaveLength(0);
      expect(result.failures).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("reports VersionIncompatible failures", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeJSON(
        join(tmpRoot, "stale"),
        validManifestObject({ name: "stale", core_version: "^99.0.0" }),
      );
      const registry = new PluginRegistry({ coreVersion: "0.2.0" });
      const result = await discover(registry, tmpRoot);
      expect(result.registered).toHaveLength(0);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].reason).toContain("core_version");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("respects recursive=false (top-level manifest only)", async () => {
    // Manifest at the root itself.
    await writeFile(
      join(tmpRoot, "dagstack.json"),
      JSON.stringify(validManifestObject({ name: "top" })),
    );
    // And one in a subdirectory — should be skipped with recursive=false.
    await writeJSON(join(tmpRoot, "nested"), validManifestObject({ name: "nested" }));
    const registry = new PluginRegistry();
    const result = await discover(registry, tmpRoot, { recursive: false });
    expect(result.registered.map((m) => m.name)).toEqual(["top"]);
  });

  it("throws when rootPath does not exist", async () => {
    const registry = new PluginRegistry();
    await expect(discover(registry, join(tmpRoot, "missing"))).rejects.toThrow(
      /does not exist or is not accessible/,
    );
  });

  it("throws when rootPath is a file, not a directory", async () => {
    const filePath = join(tmpRoot, "notadir.json");
    await writeFile(filePath, "{}");
    const registry = new PluginRegistry();
    await expect(discover(registry, filePath)).rejects.toThrow(/is not a directory/);
  });
});
