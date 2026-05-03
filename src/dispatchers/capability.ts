/**
 * Capability dispatch (ADR-0002 §"Capability") — selection based on
 * declared `capabilities`. The dispatcher picks the highest-priority
 * plugin whose `manifest.capabilities` contains every required
 * capability. Plugins with `fallback: true` participate only after
 * non-fallback candidates are exhausted.
 *
 * Used for "best handler" routing: pick the chunker that supports
 * Python; pick the LLM provider that supports tool calling; pick
 * the storage backend that supports the requested transaction mode.
 */

import { AmbiguousPlugin, KindUnknown } from "../errors.js";

import { type Dispatcher, getHookMethod, type LoadedPlugin } from "./types.js";

export interface CapabilityRequirement {
  /** Every listed capability MUST be in the plugin's `capabilities` list. */
  required: ReadonlyArray<string>;
}

export class CapabilityDispatcher<I = unknown, O = unknown>
  implements Dispatcher<I & { capabilities?: CapabilityRequirement }, O>
{
  readonly dispatchClass = "capability" as const;
  constructor(public readonly kind: string) {}

  async dispatch(
    plugins: ReadonlyArray<LoadedPlugin>,
    hook: string,
    input: I & { capabilities?: CapabilityRequirement },
  ): Promise<O> {
    const required = input.capabilities?.required ?? [];
    const candidates = plugins.filter(
      (p) =>
        p.manifest.kind === this.kind &&
        required.every((cap) => (p.manifest.capabilities ?? []).includes(cap)),
    );
    if (candidates.length === 0) {
      throw new KindUnknown(
        `${this.kind} (no plugin satisfies capabilities: ${required.join(", ") || "<none>"})`,
      );
    }
    const nonFallback = candidates.filter((c) => !c.manifest.fallback);
    const pool = nonFallback.length > 0 ? nonFallback : candidates;
    const maxPriority = Math.max(...pool.map((p) => p.manifest.priority));
    const top = pool.filter((p) => p.manifest.priority === maxPriority);
    if (top.length > 1) {
      throw new AmbiguousPlugin(
        this.kind,
        top.map((c) => c.manifest.name),
      );
    }
    const chosen = top[0];
    const fn = getHookMethod(chosen, hook);
    if (fn === undefined) {
      throw new Error(`Plugin ${chosen.manifest.name} does not implement hook ${hook}.`);
    }
    return (await fn(input)) as O;
  }
}
