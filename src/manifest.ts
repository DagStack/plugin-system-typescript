/**
 * Plugin manifest schema.
 *
 * Single source of truth for the registry. The shape here mirrors
 * `dagstack/plugin-system-spec/_meta/manifest.schema.json` and the Python
 * binding's `dagstack.plugin_system.manifest.PluginManifest`.
 *
 * TODO(spec emit): the spec ships a JSON Schema and emits Python pydantic
 * models from it; the TypeScript emitter currently covers only `kinds/*`.
 * Until the manifest emitter lands, this file is hand-written but stays
 * 1-to-1 with the spec. When the emitter ships, this file will be
 * replaced by `_generated/manifest.ts` and re-exported from here.
 */

import { z } from "zod";

export const SUPPORTED_SCHEMA_VERSION = "1.0.0" as const;

const ResourcesSpecSchema = z
  .object({
    required: z.array(z.string()).optional(),
    optional: z.array(z.string()).optional(),
  })
  .strict();

const UnitOfWorkSpecSchema = z
  .object({
    declared: z.boolean().default(false),
    partition_key: z.string().nullable().default(null),
    estimated_duration_sec: z.number().int().nullable().default(null),
    idempotency_mode: z.enum(["output_hash", "input_hash", "none"]).default("none"),
    checkpointable: z.boolean().default(false),
  })
  .strict();

export const RuntimeKindSchema = z.enum(["in_process", "mcp_stdio", "mcp_http"]);
export type RuntimeKind = z.infer<typeof RuntimeKindSchema>;

export const ExecutionModelSchema = z.enum([
  "sync",
  "async",
  "thread_cpu_bound",
  "process_cpu_bound",
]);
export type ExecutionModel = z.infer<typeof ExecutionModelSchema>;

export const PluginManifestSchema = z
  .object({
    // ── Required (ADR-0001 §"Plugin Manifest") ───────────────────────────────
    schema_version: z.string(),
    name: z.string().min(1),
    kind: z.string().min(1),
    kind_api_version: z.string(),
    core_version: z.string(),
    runtime: RuntimeKindSchema,

    // ── Metadata ─────────────────────────────────────────────────────────────
    license: z.string().nullable().default(null),
    maintainer: z.string().nullable().default(null),
    homepage: z.string().nullable().default(null),

    // ── Selection / dispatch ─────────────────────────────────────────────────
    capabilities: z.array(z.string()).optional(),
    priority: z.number().int().min(0).default(0),
    depends_on: z.array(z.string()).optional(),
    tryfirst: z.boolean().default(false),
    trylast: z.boolean().default(false),
    fallback: z.boolean().default(false),

    // ── Capability filters ───────────────────────────────────────────────────
    supports_languages: z.array(z.string()).optional(),
    supports_extensions: z.array(z.string()).optional(),
    supports_mime_types: z.array(z.string()).optional(),

    // ── Lifecycle ────────────────────────────────────────────────────────────
    startup_timeout_sec: z.number().int().positive().default(30),
    teardown_timeout_sec: z.number().int().positive().default(15),
    execution_model: ExecutionModelSchema.default("sync"),
    in_process_only: z.boolean().default(false),

    // ── Resources / unit_of_work (ADR-0003) ──────────────────────────────────
    resources: ResourcesSpecSchema.optional(),
    unit_of_work: UnitOfWorkSpecSchema.optional(),

    // ── Runtime addresses (in-process / mcp_stdio / mcp_http) ────────────────
    entry_point: z.string().nullable().default(null),
    health_check: z.string().nullable().default(null),
    command: z.array(z.string()).nullable().default(null),
    env: z.record(z.string()).nullable().default(null),
    url: z.string().nullable().default(null),
    auth: z.record(z.unknown()).nullable().default(null),
  })
  .strict()
  .superRefine((m, ctx) => {
    // Cross-field invariants (ADR-0001 §"Runtime addresses", ADR-0002 §"Lifecycle ordering").
    if (m.runtime === "in_process" && m.entry_point === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entry_point"],
        message: "entry_point is required when runtime=in_process",
      });
    }
    if (m.runtime === "mcp_stdio" && (m.command === null || m.command.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["command"],
        message: "command is required when runtime=mcp_stdio",
      });
    }
    if (m.runtime === "mcp_http" && m.url === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "url is required when runtime=mcp_http",
      });
    }
    // tryfirst and trylast are mutually exclusive (ADR-0002 §"Lifecycle ordering").
    if (m.tryfirst && m.trylast) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tryfirst"],
        message: "tryfirst and trylast cannot both be true",
      });
    }
  });

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginManifestInput = z.input<typeof PluginManifestSchema>;
