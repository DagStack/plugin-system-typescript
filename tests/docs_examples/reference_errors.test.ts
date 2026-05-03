// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/reference/errors.mdx`.

import { describe, expect, it } from "vitest";

import {
  AmbiguousPlugin,
  isAmbiguousPlugin,
  isVersionIncompatible,
  KindUnknown,
  ManifestInvalid,
  PluginLoadError,
  VersionIncompatible,
} from "../../src/index.js";

describe("reference/errors.mdx — TypeScript", () => {
  it("snippet: error classes are constructable and tagged with code", () => {
    const ambig = new AmbiguousPlugin("payment_provider", ["a", "b"]);
    expect(ambig.code).toBe("AmbiguousPlugin");
    expect(isAmbiguousPlugin(ambig)).toBe(true);

    const vi = new VersionIncompatible("p", "^99.0.0", "0.2.0");
    expect(vi.code).toBe("VersionIncompatible");
    expect(isVersionIncompatible(vi)).toBe(true);

    const unknown = new KindUnknown("missing");
    const invalid = new ManifestInvalid("schema fail", "anonymous");
    const load = new PluginLoadError("p", new Error("inner"));
    expect(unknown.kind).toBe("missing");
    expect(invalid.source).toBe("anonymous");
    expect(load.pluginName).toBe("p");
  });

  it("snippet: try/catch dispatch with isAmbiguousPlugin / isVersionIncompatible", () => {
    function handle(err: unknown): string {
      if (isAmbiguousPlugin(err)) {
        return `ambig:${err.kind}:${err.candidates.join(",")}`;
      }
      if (isVersionIncompatible(err)) {
        return `vi:${err.pluginName}:${err.requiredCoreRange}`;
      }
      throw err;
    }

    expect(handle(new AmbiguousPlugin("k", ["x", "y"]))).toBe("ambig:k:x,y");
    expect(handle(new VersionIncompatible("p", "^99.0.0", "0.2.0"))).toBe("vi:p:^99.0.0");
  });
});
