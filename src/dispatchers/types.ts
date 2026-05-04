/**
 * Common types for the five dispatch classes (ADR-0002 §"Hook
 * invocation semantics"). Each dispatcher implements a different
 * fan-out / fan-in pattern over a list of LoadedPlugin's.
 *
 * Dispatchers do NOT know about discovery or lifecycle — they receive
 * a list of plugins and an args payload, and call the named hook on
 * each. Integration with `PluginRegistry` and the runtime lifecycle
 * is the job of TS-4.
 */

import type { PluginManifest } from "../manifest.js";

/**
 * Sentinel value a `chain` plugin returns to short-circuit the chain —
 * subsequent plugins are skipped, the dispatcher returns the value that
 * was passed _in_ to the short-circuiting hook.
 *
 * Mirrors `dagstack.plugin_system.dispatch.STOP_CHAIN` (Python).
 * Cross-realm-safe via `Symbol.for`.
 */
export const STOP_CHAIN: unique symbol = Symbol.for("dagstack.plugin_system.STOP_CHAIN");
export type StopChain = typeof STOP_CHAIN;

/**
 * A plugin manifest paired with its loaded instance. The instance is
 * expected to expose the hook methods declared by its kind contract.
 */
export interface LoadedPlugin {
  manifest: PluginManifest;
  /** The instance that was created from `manifest.entry_point` and went through `setup()`. */
  instance: unknown;
}

/**
 * Generic dispatcher contract. Each of the five concrete dispatchers
 * implements it with a different fan-out/fan-in shape.
 *
 * @typeParam I — the input args type for the hook.
 * @typeParam O — the output type. For broadcast_notify it's `void`.
 */
export interface Dispatcher<I, O> {
  /** Stable name of the dispatch class — matches the `dispatch:` field in kind YAML hookspecs. */
  readonly dispatchClass:
    | "singleton"
    | "broadcast_collect"
    | "broadcast_notify"
    | "chain"
    | "capability";

  /** Run the named hook over the provided plugins; result shape depends on the class. */
  dispatch(plugins: ReadonlyArray<LoadedPlugin>, hook: string, input: I): Promise<O>;
}

/**
 * Order plugins for chain / sequential dispatch. Replicates pluggy's
 * tryfirst / trylast semantics:
 *   - tryfirst plugins run first, in priority desc;
 *   - normal plugins run, in priority desc;
 *   - trylast plugins run last, in priority desc.
 *
 * Within each band, registration order resolves ties.
 */
export function orderForChain(plugins: ReadonlyArray<LoadedPlugin>): LoadedPlugin[] {
  const indexed = plugins.map((p, idx) => ({ p, idx }));
  const tryfirst = indexed.filter((e) => e.p.manifest.tryfirst);
  const trylast = indexed.filter((e) => e.p.manifest.trylast);
  const normal = indexed.filter((e) => !e.p.manifest.tryfirst && !e.p.manifest.trylast);
  const sortBand = (band: typeof indexed) =>
    [...band].sort((a, b) => {
      if (a.p.manifest.priority !== b.p.manifest.priority) {
        return b.p.manifest.priority - a.p.manifest.priority;
      }
      return a.idx - b.idx;
    });
  return [...sortBand(tryfirst), ...sortBand(normal), ...sortBand(trylast)].map((e) => e.p);
}

/**
 * Locate a hook method on a plugin instance. Returns the bound function
 * if present, or `undefined` if the instance lacks that hook (which is
 * normal — most plugins implement only some hooks of their kind).
 */
export function getHookMethod(
  plugin: LoadedPlugin,
  hook: string,
): ((input: unknown) => Promise<unknown> | unknown) | undefined {
  const obj = plugin.instance as Record<string, unknown> | null;
  if (obj === null || typeof obj !== "object") return undefined;
  const fn = obj[hook];
  if (typeof fn !== "function") return undefined;
  return (fn as (input: unknown) => unknown).bind(obj) as (
    input: unknown,
  ) => Promise<unknown> | unknown;
}
