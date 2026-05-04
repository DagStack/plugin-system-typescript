/**
 * Shared test fixtures: build a `LoadedPlugin` from a partial manifest
 * plus an instance object. Used by all five dispatcher test files.
 */

import { PluginManifestSchema, type PluginManifest } from "../../src/manifest.js";
import type { LoadedPlugin } from "../../src/dispatchers/types.js";

const baseRaw = {
  schema_version: "1.0.0",
  name: "default",
  kind: "tool",
  kind_api_version: "1.0.0",
  core_version: "^0.2.0",
  runtime: "in_process",
  entry_point: "./plugin.js#Plugin",
};

export function buildManifest(overrides: Record<string, unknown> = {}): PluginManifest {
  return PluginManifestSchema.parse({ ...baseRaw, ...overrides });
}

export function buildPlugin(
  manifestOverrides: Record<string, unknown>,
  instance: Record<string, unknown>,
): LoadedPlugin {
  return {
    manifest: buildManifest(manifestOverrides),
    instance,
  };
}
