/**
 * Lifecycle helpers — topological sort by `depends_on`, cycle detection.
 *
 * Mirrors `dagstack.plugin_system.lifecycle.topo_sort` (Python). Used
 * by `PluginRegistry.setupAll` to start plugins in dependency order
 * and by `teardownAll` to stop them in reverse.
 */

import { DependencyCycle, MissingDependency } from "./errors.js";
import type { PluginManifest } from "./manifest.js";

/**
 * Sort manifests so each plugin's dependencies appear before it.
 *
 * Throws:
 *   - `DependencyCycle` — at least one strongly-connected component is
 *     larger than 1; the cycle is reported in the error.
 *   - `MissingDependency` — a manifest's `depends_on` entry references
 *     a name not present in the input list.
 */
export function topoSort(manifests: ReadonlyArray<PluginManifest>): PluginManifest[] {
  const byName = new Map<string, PluginManifest>();
  for (const m of manifests) byName.set(m.name, m);

  // Validate all dependencies exist.
  for (const m of manifests) {
    for (const dep of m.depends_on ?? []) {
      if (!byName.has(dep)) {
        throw new MissingDependency(m.name, dep);
      }
    }
  }

  const result: PluginManifest[] = [];
  const state = new Map<string, "white" | "gray" | "black">();
  for (const m of manifests) state.set(m.name, "white");

  const stack: string[] = [];

  function visit(name: string): void {
    const colour = state.get(name);
    if (colour === "black") return;
    if (colour === "gray") {
      // Cycle — extract from current stack.
      const cycleStart = stack.indexOf(name);
      throw new DependencyCycle(stack.slice(cycleStart));
    }
    state.set(name, "gray");
    stack.push(name);
    const m = byName.get(name)!;
    for (const dep of m.depends_on ?? []) visit(dep);
    stack.pop();
    state.set(name, "black");
    result.push(m);
  }

  for (const m of manifests) visit(m.name);
  return result;
}
