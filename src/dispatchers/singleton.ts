/**
 * Singleton dispatch — one active plugin per kind handles every call
 * (ADR-0002 §"Singleton"). Selection: highest `priority` wins; ties →
 * `AmbiguousPlugin`. No plugins → `KindUnknown`.
 *
 * Used for kinds where "several active" makes no sense: one payment
 * provider, one vector store, one orchestrator.
 */

import { AmbiguousPlugin, KindUnknown } from "../errors.js";

import { type Dispatcher, getHookMethod, type LoadedPlugin } from "./types.js";

export class SingletonDispatcher<I = unknown, O = unknown> implements Dispatcher<I, O> {
  readonly dispatchClass = "singleton" as const;
  constructor(public readonly kind: string) {}

  async dispatch(plugins: ReadonlyArray<LoadedPlugin>, hook: string, input: I): Promise<O> {
    const candidates = plugins.filter((p) => p.manifest.kind === this.kind);
    if (candidates.length === 0) {
      throw new KindUnknown(this.kind);
    }
    let chosen: LoadedPlugin;
    if (candidates.length === 1) {
      chosen = candidates[0];
    } else {
      const maxPriority = Math.max(...candidates.map((c) => c.manifest.priority));
      const top = candidates.filter((c) => c.manifest.priority === maxPriority);
      if (top.length > 1) {
        throw new AmbiguousPlugin(
          this.kind,
          top.map((c) => c.manifest.name),
        );
      }
      chosen = top[0];
    }
    const fn = getHookMethod(chosen, hook);
    if (fn === undefined) {
      throw new Error(`Plugin ${chosen.manifest.name} does not implement hook ${hook}.`);
    }
    return (await fn(input)) as O;
  }
}
