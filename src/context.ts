/**
 * Plugin context — what every plugin receives in its `setup()` call.
 *
 * Mirrors `dagstack.plugin_system.context.PluginContext` (Python). Hosts
 * pre-populate `ResourceRegistry` with named resources (HTTP client,
 * DB pool, OpenAI client, …); each plugin's `manifest.resources` lists
 * which of those it needs, and the runtime injects them into a
 * plugin-specific `PluginContext` before `setup()`.
 */

import type { PluginManifest } from "./manifest.js";

/**
 * What a plugin's `setup(ctx)` receives. The host configures `config`
 * for each plugin; `resources` is the per-plugin slice of the global
 * `ResourceRegistry` according to `manifest.resources`.
 */
export interface PluginContext {
  /** Free-form configuration object, host-supplied. */
  config: Record<string, unknown>;
  /** Per-plugin resource slice (ResourceRegistry.scopeFor(manifest)). */
  resources: ResourceRegistry;
  /** The manifest of this plugin (for self-introspection). */
  manifest: PluginManifest;
}

/**
 * Named resource catalogue. The host registers global resources up-front
 * (`http_client`, `db_pool`, …); plugins declare what they need in
 * `manifest.resources.required` and `manifest.resources.optional`.
 *
 * On `setupAll`, the runtime calls `scopeFor(manifest)` to derive a
 * per-plugin sub-registry that only exposes the declared resources.
 */
export class ResourceRegistry {
  private readonly resources = new Map<string, unknown>();

  register(name: string, value: unknown): this {
    this.resources.set(name, value);
    return this;
  }

  has(name: string): boolean {
    return this.resources.has(name);
  }

  /**
   * Strict resource lookup. Throws if the named resource is not
   * registered. Use `tryGet` for optional resources.
   */
  get<T = unknown>(name: string): T {
    if (!this.resources.has(name)) {
      throw new Error(`Resource ${name} is not registered.`);
    }
    return this.resources.get(name) as T;
  }

  tryGet<T = unknown>(name: string): T | undefined {
    return this.resources.get(name) as T | undefined;
  }

  /**
   * Build a per-plugin scoped view: only resources listed in
   * `manifest.resources.required` (strict) and `optional` (lenient)
   * are visible. Required resources missing from the host registry
   * raise immediately.
   */
  scopeFor(manifest: PluginManifest): ResourceRegistry {
    const required = manifest.resources?.required ?? [];
    const optional = manifest.resources?.optional ?? [];
    const scope = new ResourceRegistry();
    for (const name of required) {
      if (!this.resources.has(name)) {
        throw new Error(
          `Plugin ${manifest.name} requires resource ${name}, which the host has not registered.`,
        );
      }
      scope.register(name, this.resources.get(name));
    }
    for (const name of optional) {
      if (this.resources.has(name)) {
        scope.register(name, this.resources.get(name));
      }
    }
    return scope;
  }
}
