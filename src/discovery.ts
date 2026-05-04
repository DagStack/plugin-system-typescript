/**
 * File-based plugin discovery — ADR-0006.
 *
 * Walks a directory tree, finds `dagstack.json` or `dagstack.toml`
 * manifests, validates each, and registers it in a `PluginRegistry`.
 *
 * Mirrors `dagstack.plugin_system.discovery.discover` (Python). Loading
 * and instantiation of `entry_point` is out of scope here — that lands
 * in TS-4 (lifecycle).
 *
 * Continue-on-failure: a single malformed manifest does not abort the
 * walk. The caller receives `failures` alongside `registered`.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import { parse as parseToml } from "smol-toml";

import {
  isManifestInvalid,
  isVersionIncompatible,
} from "./errors.js";
import type { PluginManifest } from "./manifest.js";
import type { PluginRegistry } from "./registry.js";

const MANIFEST_BASENAMES = ["dagstack.json", "dagstack.toml"] as const;

const DEFAULT_IGNORE: ReadonlyArray<string> = [
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  ".next",
  ".cache",
  ".venv",
  ".venv-*",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
];

export interface DiscoverOptions {
  /** Walk subdirectories. Default: true. */
  recursive?: boolean;
  /**
   * Extra directory-name patterns to skip during walk, in addition to
   * `DEFAULT_IGNORE`. Glob-style — `*`, `?`, `[abc]` supported.
   */
  ignore?: ReadonlyArray<string>;
}

export interface DiscoveryFailure {
  /** Absolute path of the manifest that failed. */
  path: string;
  /** Human-readable reason. */
  reason: string;
}

export interface DiscoverResult {
  /** Manifests successfully validated and added to the registry. */
  registered: PluginManifest[];
  /** Manifests that did not pass validation; logged via console.warn. */
  failures: DiscoveryFailure[];
}

/**
 * Discover plugin manifests under `rootPath` and register them in
 * `registry`. Returns a summary of registered manifests and failures.
 *
 * @param registry — the target registry; manifests are added in walk order.
 * @param rootPath — absolute or working-directory-relative path to scan.
 * @param options — see {@link DiscoverOptions}.
 *
 * @example
 *   import { PluginRegistry, discover } from "@dagstack/plugin-system";
 *
 *   const registry = new PluginRegistry();
 *   const result = await discover(registry, "./plugins");
 *   if (result.failures.length > 0) {
 *     console.error("Discovery failures:", result.failures);
 *   }
 */
export async function discover(
  registry: PluginRegistry,
  rootPath: string,
  options: DiscoverOptions = {},
): Promise<DiscoverResult> {
  const recursive = options.recursive ?? true;
  const ignore = [...DEFAULT_IGNORE, ...(options.ignore ?? [])];

  const result: DiscoverResult = { registered: [], failures: [] };

  let rootStat;
  try {
    rootStat = await stat(rootPath);
  } catch (err) {
    throw new Error(
      `discover: rootPath ${rootPath} does not exist or is not accessible: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`discover: rootPath ${rootPath} is not a directory`);
  }

  const manifestPaths: string[] = [];
  await walk(rootPath, manifestPaths, ignore, recursive);
  manifestPaths.sort();

  for (const path of manifestPaths) {
    let raw: unknown;
    try {
      raw = await loadManifestFile(path);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.failures.push({ path, reason });
      console.warn(`[dagstack/plugin-system] failed to read ${path}: ${reason}`);
      continue;
    }
    try {
      const manifest = registry.registerManifest(raw, `file:${resolve(path)}`);
      result.registered.push(manifest);
    } catch (err) {
      let reason: string;
      if (isManifestInvalid(err) || isVersionIncompatible(err)) {
        reason = err.message;
      } else {
        reason = err instanceof Error ? err.message : String(err);
      }
      result.failures.push({ path, reason });
      console.warn(`[dagstack/plugin-system] skipping ${path}: ${reason}`);
    }
  }

  return result;
}

async function walk(
  dir: string,
  manifests: string[],
  ignore: ReadonlyArray<string>,
  recursive: boolean,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(
      `[dagstack/plugin-system] cannot read directory ${dir}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!recursive) continue;
      if (matchesAny(entry.name, ignore)) continue;
      await walk(join(dir, entry.name), manifests, ignore, recursive);
      continue;
    }
    if (entry.isFile() && (MANIFEST_BASENAMES as ReadonlyArray<string>).includes(entry.name)) {
      manifests.push(join(dir, entry.name));
    }
  }
}

async function loadManifestFile(path: string): Promise<unknown> {
  const ext = extname(path).toLowerCase();
  const content = await readFile(path, "utf8");
  if (ext === ".json") {
    try {
      const parsed = JSON.parse(content) as unknown;
      return unwrapPluginSection(parsed);
    } catch (err) {
      throw new Error(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (ext === ".toml") {
    try {
      const parsed = parseToml(content);
      return unwrapPluginSection(parsed);
    } catch (err) {
      throw new Error(`invalid TOML: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`unknown manifest extension ${ext}`);
}

/**
 * Manifests that follow the `[plugin]` table convention (TOML / JSON
 * with `{"plugin": {...}}`) wrap fields under a single key. Both
 * Python and Go bindings unwrap this, so we do too.
 */
function unwrapPluginSection(parsed: unknown): unknown {
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    "plugin" in parsed &&
    Object.keys(parsed).length === 1 &&
    typeof (parsed as { plugin: unknown }).plugin === "object" &&
    (parsed as { plugin: unknown }).plugin !== null
  ) {
    return (parsed as { plugin: unknown }).plugin;
  }
  return parsed;
}

function matchesAny(name: string, patterns: ReadonlyArray<string>): boolean {
  for (const pattern of patterns) {
    if (matchesGlob(name, pattern)) return true;
  }
  return false;
}

/** Minimal fnmatch — supports `*`, `?`, `[abc]`. Mirrors Python's fnmatch.fnmatch for ASCII. */
function matchesGlob(name: string, pattern: string): boolean {
  if (!pattern.includes("*") && !pattern.includes("?") && !pattern.includes("[")) {
    return name === pattern;
  }
  const regex = globToRegex(pattern);
  return regex.test(name);
}

function globToRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      out += ".*";
    } else if (ch === "?") {
      out += ".";
    } else if (ch === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) {
        out += "\\[";
      } else {
        out += `[${pattern.slice(i + 1, close)}]`;
        i = close;
      }
    } else if (/[.+^${}()|\\]/.test(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}
