// Mirror of TypeScript snippet in
// `dagstack-plugin-system-docs/site/docs/guides/dependencies.mdx`.

import { describe, expect, it } from "vitest";

import { PluginRegistry, topoSort } from "../../src/index.js";
import { buildManifest } from "../__fixtures__/plugins.js";

describe("guides/dependencies.mdx — TypeScript", () => {
  it("snippet: topoSort returns parents before dependents", () => {
    const registry = new PluginRegistry();
    registry.registerManifest(buildManifest({ name: "postgres" }));
    registry.registerManifest(buildManifest({ name: "user-store", depends_on: ["postgres"] }));
    registry.registerManifest(buildManifest({ name: "auth", depends_on: ["user-store"] }));

    const ordered = topoSort([...registry.list()]);
    const names = ordered.map((m) => m.name);
    expect(names.indexOf("postgres")).toBeLessThan(names.indexOf("user-store"));
    expect(names.indexOf("user-store")).toBeLessThan(names.indexOf("auth"));
  });
});
