import { describe, expect, it } from "vitest";

import {
  AmbiguousPlugin,
  isAmbiguousPlugin,
  isKindUnknown,
  isManifestInvalid,
  isVersionIncompatible,
  KindUnknown,
  ManifestInvalid,
  PluginRegistry,
  VersionIncompatible,
} from "../src/index.js";

const validManifest = (overrides: Record<string, unknown> = {}) => ({
  schema_version: "1.0.0",
  name: "echo",
  kind: "tool",
  kind_api_version: "1.0.0",
  core_version: "^0.2.0",
  runtime: "in_process",
  entry_point: "src/plugin.js#EchoPlugin",
  ...overrides,
});

describe("PluginRegistry — registerManifest", () => {
  it("registers a valid manifest and returns the parsed value", () => {
    const r = new PluginRegistry();
    const m = r.registerManifest(validManifest());
    expect(m.name).toBe("echo");
    expect(m.priority).toBe(0);
    expect(r.list()).toHaveLength(1);
  });

  it("throws ManifestInvalid on schema violation", () => {
    const r = new PluginRegistry();
    expect(() => r.registerManifest({ name: "x" })).toThrowError(ManifestInvalid);
    try {
      r.registerManifest({ name: "x" });
    } catch (err) {
      expect(isManifestInvalid(err)).toBe(true);
    }
  });

  it("throws ManifestInvalid on duplicate name", () => {
    const r = new PluginRegistry();
    r.registerManifest(validManifest());
    expect(() => r.registerManifest(validManifest())).toThrowError(ManifestInvalid);
  });

  it("rejects unsupported schema_version", () => {
    const r = new PluginRegistry();
    expect(() => r.registerManifest(validManifest({ schema_version: "9.0.0" }))).toThrowError(
      ManifestInvalid,
    );
  });

  it("throws VersionIncompatible when core_version range excludes runtime", () => {
    const r = new PluginRegistry({ coreVersion: "0.2.0" });
    expect(() => r.registerManifest(validManifest({ core_version: "^99.0.0" }))).toThrowError(
      VersionIncompatible,
    );
    try {
      r.registerManifest(validManifest({ core_version: "^99.0.0", name: "two" }));
    } catch (err) {
      expect(isVersionIncompatible(err)).toBe(true);
    }
  });

  it("rejects an invalid SemVer range with ManifestInvalid", () => {
    const r = new PluginRegistry();
    expect(() => r.registerManifest(validManifest({ core_version: "not-a-range" }))).toThrowError(
      ManifestInvalid,
    );
  });
});

describe("PluginRegistry — getPlugin", () => {
  it("returns the unique plugin of a kind", () => {
    const r = new PluginRegistry();
    r.registerManifest(validManifest());
    expect(r.getPlugin("tool").name).toBe("echo");
  });

  it("throws KindUnknown when no plugin is registered", () => {
    const r = new PluginRegistry();
    expect(() => r.getPlugin("tool")).toThrowError(KindUnknown);
    try {
      r.getPlugin("tool");
    } catch (err) {
      expect(isKindUnknown(err)).toBe(true);
    }
  });

  it("picks the higher-priority plugin when multiple match", () => {
    const r = new PluginRegistry();
    r.registerManifest(validManifest({ name: "low", priority: 10 }));
    r.registerManifest(validManifest({ name: "high", priority: 50 }));
    expect(r.getPlugin("tool").name).toBe("high");
  });

  it("throws AmbiguousPlugin when two plugins share max priority", () => {
    const r = new PluginRegistry();
    r.registerManifest(validManifest({ name: "a", priority: 50 }));
    r.registerManifest(validManifest({ name: "b", priority: 50 }));
    expect(() => r.getPlugin("tool")).toThrowError(AmbiguousPlugin);
    try {
      r.getPlugin("tool");
    } catch (err) {
      expect(isAmbiguousPlugin(err)).toBe(true);
      if (isAmbiguousPlugin(err)) {
        expect(err.candidates).toEqual(["a", "b"]);
        expect(err.kind).toBe("tool");
      }
    }
  });

  it("returns the named plugin when name is given", () => {
    const r = new PluginRegistry();
    r.registerManifest(validManifest({ name: "a", priority: 50 }));
    r.registerManifest(validManifest({ name: "b", priority: 50 }));
    expect(r.getPlugin("tool", "a").name).toBe("a");
  });
});

describe("PluginRegistry — resolve", () => {
  it("returns a manifest by exact (kind, name) pair", () => {
    const r = new PluginRegistry();
    r.registerManifest(validManifest());
    expect(r.resolve("tool", "echo").name).toBe("echo");
  });

  it("throws KindUnknown when name is not registered", () => {
    const r = new PluginRegistry();
    expect(() => r.resolve("tool", "missing")).toThrowError(KindUnknown);
  });

  it("throws KindUnknown when name is registered under a different kind", () => {
    const r = new PluginRegistry();
    r.registerManifest(validManifest({ kind: "orchestrator" }));
    expect(() => r.resolve("tool", "echo")).toThrowError(KindUnknown);
  });
});

describe("PluginRegistry — list and metadata", () => {
  it("returns manifests in registration order", () => {
    const r = new PluginRegistry();
    r.registerManifest(validManifest({ name: "first" }));
    r.registerManifest(validManifest({ name: "second" }));
    r.registerManifest(validManifest({ name: "third" }));
    expect(r.list().map((m) => m.name)).toEqual(["first", "second", "third"]);
  });

  it("exposes the configured coreVersion", () => {
    const r = new PluginRegistry({ coreVersion: "0.5.0" });
    expect(r.getCoreVersion()).toBe("0.5.0");
  });

  it("rejects an invalid coreVersion at construction", () => {
    expect(() => new PluginRegistry({ coreVersion: "garbage" })).toThrowError();
  });
});
