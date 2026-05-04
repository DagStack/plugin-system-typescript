/**
 * AUTO-GENERATED. Do not edit.
 *
 * Source: dagstack/plugin-system-spec — kinds/orchestrator/v1.yaml
 * Kind:   orchestrator
 * API:    1.0.0
 *
 * Singleton plugin (only one per runtime); responsible for running
 * unit-of-work plugins: enqueueing work, tracking statuses, retries,
 * checkpointing, and backfill. Always in_process_only=true (an
 * orchestrator cannot live behind the MCP wire — it keeps state in the
 * host process memory).
 */
import { z } from "zod";

export const KIND_NAME = "orchestrator" as const;
export const KIND_API_VERSION = "1.0.0" as const;

export const EnqueueInputSchema = z.object({
  /** Name of the unit-of-work plugin, taken from its manifest. */
  plugin_name: z.string(),
  /** Arguments for the unit-of-work plugin. */
  args: z.record(z.unknown()),
  /** Optional key for deduplication. */
  idempotency_key: z.string().optional(),
  /** Partition used for sharding (see DST-0003 §Invariant 5). */
  partition_key: z.string().optional(),
}).strict();
export type EnqueueInput = z.infer<typeof EnqueueInputSchema>;

export const EnqueueOutputSchema = z.object({
  /** Globally unique id (UUID or ULID) used for tracking. */
  unit_id: z.string(),
  /** true if a unit with this idempotency_key already existed. */
  deduplicated: z.boolean(),
}).strict();
export type EnqueueOutput = z.infer<typeof EnqueueOutputSchema>;

export const StatusInputSchema = z.object({
  unit_id: z.string(),
}).strict();
export type StatusInput = z.infer<typeof StatusInputSchema>;

export const StatusOutputSchema = z.object({
  unit_id: z.string(),
  state: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "expired"]),
  started_at: z.string().datetime().optional(),
  finished_at: z.string().datetime().optional(),
  /** Optional sink aggregate: % completion, last_checkpoint, etc. */
  progress: z.record(z.unknown()).optional(),
  error: z.string().optional(),
}).strict();
export type StatusOutput = z.infer<typeof StatusOutputSchema>;

export const BackfillInputSchema = z.object({
  /** Optional: only this plugin. */
  plugin_name: z.string().optional(),
  /** Optional: only this partition. */
  partition_key: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  /** Which states to re-run. Default: failed+expired. */
  states: z.array(z.enum(["failed", "expired", "cancelled"])).optional(),
}).strict();
export type BackfillInput = z.infer<typeof BackfillInputSchema>;

export const BackfillOutputSchema = z.object({
  /** How many units of work were re-enqueued. */
  enqueued_count: z.number().int(),
  /** How many were skipped (did not match the filter / already running). */
  skipped_count: z.number().int().optional(),
}).strict();
export type BackfillOutput = z.infer<typeof BackfillOutputSchema>;

/** Hook metadata: dispatch class per hook (read by the registry). */
export const HOOK_DISPATCH = {
  enqueue: "singleton" as const,
  status: "singleton" as const,
  backfill: "singleton" as const,
} as const;

/** MCP exposure: which hooks register automatically in an MCP server. */
export const HOOK_MCP_EXPOSED = {
  enqueue: false,
  status: false,
  backfill: false,
} as const;

/** orchestrator plugin contract — kind_api_version=1.0.0. */
export interface OrchestratorPlugin {
  /**
   * Dispatch: singleton.
   *
   * Enqueue a unit of work for execution. Returns a unit_id for
   * tracking. The implementation must be idempotent on
   * `idempotency_key` when one is supplied.
   */
  enqueue(payload: EnqueueInput): EnqueueOutput;
  /**
   * Dispatch: singleton.
   *
   * Current status of a unit of work, looked up by unit_id.
   */
  status(payload: StatusInput): StatusOutput;
  /**
   * Dispatch: singleton.
   *
   * Re-run failed/expired units selected by a filter (partition, time,
   * state).
   */
  backfill(payload: BackfillInput): BackfillOutput;
}
