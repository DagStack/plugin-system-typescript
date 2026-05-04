/**
 * Broadcast-collect dispatch (ADR-0002 §"Broadcast-Collect") — every
 * plugin of the kind handles the call in parallel; the dispatcher
 * collects all results into an array, preserving registration order.
 *
 * Errors propagate (`Promise.all` semantics). For fire-and-forget
 * fan-out without error propagation, use `BroadcastNotifyDispatcher`.
 */

import { type Dispatcher, getHookMethod, type LoadedPlugin } from "./types.js";

export class BroadcastCollectDispatcher<I = unknown, O = unknown>
  implements Dispatcher<I, O[]>
{
  readonly dispatchClass = "broadcast_collect" as const;
  constructor(public readonly kind: string) {}

  async dispatch(
    plugins: ReadonlyArray<LoadedPlugin>,
    hook: string,
    input: I,
  ): Promise<O[]> {
    const candidates = plugins.filter((p) => p.manifest.kind === this.kind);
    const tasks: Promise<O>[] = [];
    for (const plugin of candidates) {
      const fn = getHookMethod(plugin, hook);
      if (fn === undefined) continue;
      // Async IIFE catches synchronous throws inside `fn` and turns them
      // into rejected promises — Promise.all then surfaces them as the
      // final rejection, matching the contract.
      tasks.push((async () => fn(input))().then((v) => v as O));
    }
    return Promise.all(tasks);
  }
}
