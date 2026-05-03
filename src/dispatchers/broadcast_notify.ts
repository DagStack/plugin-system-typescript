/**
 * Broadcast-notify dispatch (ADR-0002 §"Broadcast-Notify") —
 * fire-and-forget fan-out. Every plugin gets the event in parallel
 * (`Promise.allSettled`); errors are swallowed and logged via
 * `console.warn`. Returns when every plugin has either completed or
 * thrown.
 *
 * Use for events where the caller does not care about the result:
 * progress, audit logs, notifications.
 */

import { type Dispatcher, getHookMethod, type LoadedPlugin } from "./types.js";

export interface BroadcastNotifyResult {
  /** Plugins whose hook completed successfully. */
  delivered: number;
  /** Plugins whose hook threw — accompanied by the manifest name. */
  failed: ReadonlyArray<{ name: string; error: unknown }>;
}

export class BroadcastNotifyDispatcher<I = unknown>
  implements Dispatcher<I, BroadcastNotifyResult>
{
  readonly dispatchClass = "broadcast_notify" as const;
  constructor(public readonly kind: string) {}

  async dispatch(
    plugins: ReadonlyArray<LoadedPlugin>,
    hook: string,
    input: I,
  ): Promise<BroadcastNotifyResult> {
    const candidates = plugins.filter((p) => p.manifest.kind === this.kind);
    const tasks: Array<{ name: string; promise: Promise<unknown> }> = [];
    for (const plugin of candidates) {
      const fn = getHookMethod(plugin, hook);
      if (fn === undefined) continue;
      tasks.push({
        name: plugin.manifest.name,
        // Wrap in an async IIFE so that a synchronous throw inside `fn`
        // surfaces as a rejected promise instead of escaping the loop —
        // `Promise.allSettled` then catches it like any other rejection.
        promise: (async () => fn(input))(),
      });
    }
    const settled = await Promise.allSettled(tasks.map((t) => t.promise));
    let delivered = 0;
    const failed: Array<{ name: string; error: unknown }> = [];
    settled.forEach((res, idx) => {
      if (res.status === "fulfilled") {
        delivered += 1;
      } else {
        failed.push({ name: tasks[idx].name, error: res.reason });
        console.warn(
          `[dagstack/plugin-system] broadcast_notify(${this.kind}.${hook}): plugin ${tasks[idx].name} failed:`,
          res.reason,
        );
      }
    });
    return { delivered, failed };
  }
}
