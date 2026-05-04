/**
 * Chain dispatch (ADR-0002 §"Chain") — plugins of the kind run
 * sequentially; the output of plugin N becomes the input of plugin N+1.
 * Order: priority desc, with `tryfirst` plugins promoted to the front
 * and `trylast` plugins demoted to the back (pluggy semantics — see
 * `orderForChain`).
 *
 * Errors propagate from the failing plugin and abort the chain. Used
 * for transformation pipelines: pre-processing → embedding → ranking,
 * or middleware-style request mutation.
 */

import { type Dispatcher, getHookMethod, type LoadedPlugin, orderForChain, STOP_CHAIN } from "./types.js";

export class ChainDispatcher<T = unknown> implements Dispatcher<T, T> {
  readonly dispatchClass = "chain" as const;
  constructor(public readonly kind: string) {}

  async dispatch(plugins: ReadonlyArray<LoadedPlugin>, hook: string, input: T): Promise<T> {
    const candidates = orderForChain(plugins.filter((p) => p.manifest.kind === this.kind));
    let value: T = input;
    for (const plugin of candidates) {
      const fn = getHookMethod(plugin, hook);
      if (fn === undefined) continue;
      const next = await fn(value);
      // STOP_CHAIN sentinel — short-circuit, return the value passed _in_
      // to this hook (matches Python `dispatch.py:572`).
      if ((next as unknown) === STOP_CHAIN) {
        return value;
      }
      value = next as T;
    }
    return value;
  }
}
