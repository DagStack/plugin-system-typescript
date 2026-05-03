/**
 * PluginRegistry — manifests, instances, lifecycle.
 *
 * Mirrors `dagstack.plugin_system.registry.PluginRegistry` (Python).
 * Composes:
 *   - registration / validation / lookup (TS-1);
 *   - integration with `discover()` (TS-2 sets `source`);
 *   - dispatcher integration via `getLoadedPlugins()` (TS-3 consumes the list);
 *   - lifecycle: `attachPlugin`, `setupAll`, `teardownAll` (TS-4).
 */

import semver from "semver";

import { ResourceRegistry } from "./context.js";
import type { PluginContext } from "./context.js";
import type { LoadedPlugin } from "./dispatchers/types.js";
import {
  AmbiguousPlugin,
  KindUnknown,
  ManifestInvalid,
  PluginLoadError,
  TeardownErrors,
  VersionIncompatible,
} from "./errors.js";
import { topoSort } from "./lifecycle.js";
import {
  PluginManifestSchema,
  SUPPORTED_SCHEMA_VERSION,
  type PluginManifest,
} from "./manifest.js";
import { VERSION } from "./version.js";

export interface PluginRegistryOptions {
  /**
   * Version of the runtime that hosts this registry. Plugin manifests
   * must declare a `core_version` range that is compatible. Defaults to
   * the package's published `VERSION`.
   */
  coreVersion?: string;
}

interface RegisteredPlugin {
  manifest: PluginManifest;
  source: string;
  /** Set after `setupAll` (or `attachPlugin`) succeeds. */
  instance?: unknown;
  /** True when teardown has run for this plugin. */
  toreDown?: boolean;
}

export interface SetupAllOptions {
  /** Per-plugin config map: `{ pluginName: configObject }`. */
  configs?: Record<string, Record<string, unknown>>;
  /** Host-supplied named resources. */
  resources?: ResourceRegistry;
}

/**
 * In-memory plugin registry. Not thread-safe; the host serialises
 * registration. Compatible with the Python and Go bindings'
 * `register_manifest` / `get_plugin` semantics.
 */
export class PluginRegistry {
  private readonly coreVersion: string;
  private readonly entries: RegisteredPlugin[] = [];
  private readonly nameToIndex = new Map<string, number>();

  constructor(options: PluginRegistryOptions = {}) {
    const cv = options.coreVersion ?? defaultCoreVersion();
    if (semver.valid(cv) === null) {
      throw new Error(
        `Invalid coreVersion ${cv}: must be a SemVer (e.g. "0.2.0").`,
      );
    }
    this.coreVersion = cv;
  }

  /**
   * Validate a manifest object against the schema and register it.
   *
   * Returns the parsed manifest (with defaults applied). The manifest
   * source string (e.g. `"file:plugins/echo/dagstack.json"`) is recorded
   * for error reporting only.
   *
   * Throws:
   *   - `ManifestInvalid` — the input fails schema validation or the
   *     name clashes with another already-registered plugin.
   *   - `VersionIncompatible` — the manifest's `core_version` does not
   *     satisfy the registry's `coreVersion`.
   */
  registerManifest(input: unknown, source = "anonymous"): PluginManifest {
    const parsed = this.parse(input, source);
    this.assertCoreCompatible(parsed);
    if (this.nameToIndex.has(parsed.name)) {
      throw new ManifestInvalid(
        `name ${parsed.name} is already registered (source: ${this.entries[this.nameToIndex.get(parsed.name)!].source})`,
        source,
      );
    }
    this.nameToIndex.set(parsed.name, this.entries.length);
    this.entries.push({ manifest: parsed, source });
    return parsed;
  }

  /** All registered manifests, in registration order. */
  list(): readonly PluginManifest[] {
    return this.entries.map((e) => e.manifest);
  }

  /**
   * Resolve a single plugin manifest by `kind` and optional `name`.
   *
   * Selection algorithm (ADR-0002 §1, paraphrased):
   *   1. If `name` is given, return the unique manifest with that name and
   *      kind. Throw `KindUnknown` if no such pair exists.
   *   2. Otherwise filter all manifests of the given kind.
   *      - 0 matches → `KindUnknown`.
   *      - 1 match → return it.
   *      - N matches → highest priority wins; ties → `AmbiguousPlugin`.
   *
   * Application routing policy and env overrides (the higher-precedence
   * steps in ADR-0002) are out of scope for TS-1 and will be added in
   * TS-3 (dispatchers).
   *
   * Returns the **manifest**, not a loaded plugin instance. After TS-4
   * (lifecycle) lands, a sibling `getInstance(kind, name?)` will return
   * the started instance; `getPlugin` keeps returning the manifest for
   * inspection and dispatch. Mirrors the Python binding's
   * `get_plugin(kind, name=None)`.
   */
  getPlugin(kind: string, name?: string): PluginManifest {
    if (name !== undefined) {
      return this.resolve(kind, name);
    }
    const candidates = this.entries.filter((e) => e.manifest.kind === kind);
    if (candidates.length === 0) {
      throw new KindUnknown(kind);
    }
    if (candidates.length === 1) {
      return candidates[0].manifest;
    }
    const maxPriority = Math.max(...candidates.map((c) => c.manifest.priority));
    const top = candidates.filter((c) => c.manifest.priority === maxPriority);
    if (top.length > 1) {
      throw new AmbiguousPlugin(
        kind,
        top.map((c) => c.manifest.name),
      );
    }
    return top[0].manifest;
  }

  /**
   * Explicit lookup of a manifest by `kind` and `name`. Throws
   * `KindUnknown` if no exact match exists. Unlike `getPlugin`, does
   * not consider priority — the name is unique.
   */
  resolve(kind: string, name: string): PluginManifest {
    const idx = this.nameToIndex.get(name);
    if (idx === undefined) {
      throw new KindUnknown(`${kind}:${name} — name not registered`);
    }
    const manifest = this.entries[idx].manifest;
    if (manifest.kind !== kind) {
      throw new KindUnknown(
        `plugin '${name}' is registered under kind='${manifest.kind}', not '${kind}'`,
      );
    }
    return manifest;
  }

  /** The core_version this registry advertises. */
  getCoreVersion(): string {
    return this.coreVersion;
  }

  // ── Lifecycle (TS-4) ─────────────────────────────────────────────────────

  /**
   * Attach an already-constructed instance to a registered manifest.
   * Used by tests, by hosts that build instances out-of-band, and by
   * `setupAll` internally after dynamic import.
   *
   * Throws `KindUnknown` when no manifest with that name is registered.
   */
  attachPlugin(name: string, instance: unknown): void {
    const idx = this.nameToIndex.get(name);
    if (idx === undefined) {
      throw new KindUnknown(`${name} — name not registered`);
    }
    this.entries[idx].instance = instance;
  }

  /**
   * Initialise every plugin: topo-order by `depends_on`, dynamic-import
   * any unattached entries, then call `instance.setup?.(ctx)` on each.
   *
   * Continue-on-failure: a single plugin that throws on import or
   * setup() does NOT abort the run; it is logged and excluded from
   * `getLoadedPlugins()`. Successful plugins are tracked so
   * `teardownAll` can stop them in reverse.
   */
  async setupAll(opts: SetupAllOptions = {}): Promise<void> {
    const sorted = topoSort(this.entries.map((e) => e.manifest));
    const resources = opts.resources ?? new ResourceRegistry();
    for (const manifest of sorted) {
      const idx = this.nameToIndex.get(manifest.name)!;
      const entry = this.entries[idx];
      try {
        if (entry.instance === undefined) {
          entry.instance = await loadInstance(manifest, entry.source);
        }
        const setup = (entry.instance as { setup?: (ctx: PluginContext) => unknown } | null)
          ?.setup;
        if (typeof setup === "function") {
          const ctx: PluginContext = {
            config: opts.configs?.[manifest.name] ?? {},
            resources: resources.scopeFor(manifest),
            manifest,
          };
          await setup.call(entry.instance, ctx);
        }
      } catch (err) {
        console.warn(
          `[dagstack/plugin-system] setup ${manifest.name} failed:`,
          err instanceof Error ? err.message : err,
        );
        entry.instance = undefined;
        entry.toreDown = true;
      }
    }
  }

  /**
   * Teardown every successfully started plugin in reverse setup order.
   * Errors are aggregated into `TeardownErrors` and thrown at the end —
   * teardown of remaining plugins still proceeds.
   */
  async teardownAll(): Promise<void> {
    const errors: { name: string; error: unknown }[] = [];
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry.instance === undefined || entry.toreDown) continue;
      const teardown = (entry.instance as { teardown?: () => unknown } | null)?.teardown;
      try {
        if (typeof teardown === "function") {
          await teardown.call(entry.instance);
        }
      } catch (err) {
        errors.push({ name: entry.manifest.name, error: err });
      } finally {
        entry.toreDown = true;
      }
    }
    if (errors.length > 0) throw new TeardownErrors(errors);
  }

  /**
   * The set of `(manifest, instance)` pairs ready for dispatch. Pass
   * directly to a `Dispatcher.dispatch(...)`.
   */
  getLoadedPlugins(): LoadedPlugin[] {
    const loaded: LoadedPlugin[] = [];
    for (const entry of this.entries) {
      if (entry.instance !== undefined && !entry.toreDown) {
        loaded.push({ manifest: entry.manifest, instance: entry.instance });
      }
    }
    return loaded;
  }

  private parse(input: unknown, source: string): PluginManifest {
    const result = PluginManifestSchema.safeParse(input);
    if (!result.success) {
      throw new ManifestInvalid(
        result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; "),
        source,
        result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    }
    if (result.data.schema_version !== SUPPORTED_SCHEMA_VERSION) {
      throw new ManifestInvalid(
        `unsupported schema_version ${result.data.schema_version} (expected ${SUPPORTED_SCHEMA_VERSION})`,
        source,
      );
    }
    return result.data;
  }

  private assertCoreCompatible(m: PluginManifest): void {
    const range = m.core_version;
    if (!semver.validRange(range)) {
      throw new ManifestInvalid(
        `core_version ${range} is not a valid SemVer range`,
        m.name,
      );
    }
    if (!semver.satisfies(this.coreVersion, range, { includePrerelease: true })) {
      throw new VersionIncompatible(m.name, range, this.coreVersion);
    }
  }
}

/**
 * Resolve and instantiate a plugin from its manifest's `entry_point`.
 *
 * `entry_point` formats:
 *   - `./plugin.js#ClassName` — dynamic-import that file (relative to
 *     the manifest's directory) and instantiate the named export.
 *   - `./plugin.js` — dynamic-import and use the default export. If
 *     it's a class, `new` it; if it's a factory, call it.
 *
 * `source` follows the convention from `discover()`:
 *   - `"file:relativePath/dagstack.json"` — a real filesystem manifest;
 *     entry_point is resolved relative to its directory.
 *   - anything else — entry_point must be importable as-is.
 */
async function loadInstance(manifest: PluginManifest, source: string): Promise<unknown> {
  const entryPoint = manifest.entry_point;
  if (entryPoint === null || entryPoint === undefined) {
    throw new PluginLoadError(
      manifest.name,
      new Error(`manifest has no entry_point — cannot load instance for runtime=${manifest.runtime}`),
    );
  }
  const [modulePath, exportName] = entryPoint.includes("#")
    ? (entryPoint.split("#") as [string, string])
    : [entryPoint, "default"];

  const importTarget = await resolveImportTarget(modulePath, source);

  let mod: Record<string, unknown>;
  try {
    mod = (await import(importTarget)) as Record<string, unknown>;
  } catch (err) {
    throw new PluginLoadError(manifest.name, err);
  }

  const exported = mod[exportName];
  if (exported === undefined) {
    throw new PluginLoadError(
      manifest.name,
      new Error(`module ${importTarget} has no export ${exportName}`),
    );
  }
  if (typeof exported === "function") {
    // Try `new` first; fall back to factory call if the constructor
    // refuses (e.g. arrow functions, factories returning objects).
    // Source-level `class` detection via `Function.prototype.toString`
    // regex is unreliable under minifiers / transpilers (terser, swc,
    // esbuild with downlevel target) — they rewrite classes as plain
    // functions and the regex returns a false negative.
    try {
      return new (exported as new () => unknown)();
    } catch (newErr) {
      const isNonConstructor =
        newErr instanceof TypeError &&
        /not a constructor|cannot be invoked without 'new'|class constructor.*cannot be invoked/i.test(
          newErr.message,
        );
      if (!isNonConstructor) {
        throw new PluginLoadError(manifest.name, newErr);
      }
      try {
        return (exported as () => unknown)();
      } catch (callErr) {
        throw new PluginLoadError(manifest.name, callErr);
      }
    }
  }
  // Already an instance / object literal.
  return exported;
}

async function resolveImportTarget(modulePath: string, source: string): Promise<string> {
  if (!modulePath.startsWith(".") && !modulePath.startsWith("/")) {
    // Bare specifier (e.g. "@scope/pkg#Class") — let Node resolve.
    return modulePath;
  }
  // Relative — anchor at the directory of the discovered manifest.
  const { resolve, dirname, isAbsolute, sep } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const sourcePath = source.startsWith("file:") ? source.slice("file:".length) : source;
  const manifestDir = isAbsolute(sourcePath) ? dirname(sourcePath) : dirname(resolve(sourcePath));
  const target = resolve(manifestDir, modulePath);
  // Path-traversal guard: target must remain within the manifest's own
  // directory. A malicious manifest must not import `../../foo.js` and
  // execute code from outside its tree.
  if (target !== manifestDir && !target.startsWith(manifestDir + sep)) {
    throw new Error(
      `entry_point ${modulePath} escapes the manifest directory ${manifestDir}`,
    );
  }
  return pathToFileURL(target).href;
}

function defaultCoreVersion(): string {
  // Strip pre-release suffix (e.g. "0.2.0-rc.1" → "0.2.0"). semver.satisfies()
  // against caret/tilde ranges treats pre-releases as ineligible unless
  // includePrerelease is set, and `core_version` ranges in plugin manifests
  // typically read like "^0.2" — they should match the stable line.
  const [base] = VERSION.split("-");
  return base;
}
