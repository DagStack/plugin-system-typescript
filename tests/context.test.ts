import { describe, expect, it } from "vitest";

import { ResourceRegistry } from "../src/index.js";
import { buildManifest } from "./__fixtures__/plugins.js";

describe("ResourceRegistry", () => {
  it("registers and retrieves a resource", () => {
    const r = new ResourceRegistry();
    r.register("http_client", { name: "axios" });
    expect(r.has("http_client")).toBe(true);
    expect(r.get<{ name: string }>("http_client").name).toBe("axios");
  });

  it("throws on get of an unregistered resource", () => {
    const r = new ResourceRegistry();
    expect(() => r.get("missing")).toThrow(/not registered/);
  });

  it("tryGet returns undefined instead of throwing", () => {
    const r = new ResourceRegistry();
    expect(r.tryGet("missing")).toBeUndefined();
  });

  it("scopeFor exposes only required and optional resources", () => {
    const host = new ResourceRegistry();
    host.register("http_client", "h").register("db_pool", "d").register("openai", "o");
    const manifest = buildManifest({
      name: "scoped",
      resources: { required: ["http_client"], optional: ["db_pool"] },
    });
    const scope = host.scopeFor(manifest);
    expect(scope.has("http_client")).toBe(true);
    expect(scope.has("db_pool")).toBe(true);
    expect(scope.has("openai")).toBe(false);
  });

  it("scopeFor throws when a required resource is not registered on host", () => {
    const host = new ResourceRegistry();
    const manifest = buildManifest({
      name: "needy",
      resources: { required: ["missing"] },
    });
    expect(() => host.scopeFor(manifest)).toThrow(/requires resource missing/);
  });

  it("scopeFor without resources block yields an empty scope", () => {
    const host = new ResourceRegistry();
    host.register("http_client", "h");
    const manifest = buildManifest({ name: "minimal" });
    const scope = host.scopeFor(manifest);
    expect(scope.has("http_client")).toBe(false);
  });

  it("scopeFor skips optional resources that are not registered", () => {
    const host = new ResourceRegistry();
    host.register("http_client", "h");
    const manifest = buildManifest({
      name: "o",
      resources: { required: [], optional: ["http_client", "absent"] },
    });
    const scope = host.scopeFor(manifest);
    expect(scope.has("http_client")).toBe(true);
    expect(scope.has("absent")).toBe(false);
  });
});
