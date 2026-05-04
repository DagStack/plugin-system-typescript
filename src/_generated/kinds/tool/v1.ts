/**
 * AUTO-GENERATED. Do not edit.
 *
 * Source: dagstack/plugin-system-spec — kinds/tool/v1.yaml
 * Kind:   tool
 * API:    1.0.0
 *
 * Function-style plugin: one or more executable hooks; each takes
 * structured args and returns a structured result. Used as the unit for
 * agent tool catalogues, MCP tool registration, and model tool calling.
 */
import { z } from "zod";

export const KIND_NAME = "tool" as const;
export const KIND_API_VERSION = "1.0.0" as const;

export const EmptySchema = z.record(z.unknown());
export type Empty = z.infer<typeof EmptySchema>;

export const FunctionSchemaSchema = z.object({
  /** Globally unique function name within the plugin's namespace. snake_case. */
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  /** What the function does. Used by the LLM when selecting a tool. */
  description: z.string(),
  /** JSON Schema for the function's arguments (as in OpenAI function calling). */
  parameters: z.record(z.unknown()),
}).strict();
export type FunctionSchema = z.infer<typeof FunctionSchemaSchema>;

export const GetSchemaOutputSchema = z.array(FunctionSchemaSchema);
export type GetSchemaOutput = z.infer<typeof GetSchemaOutputSchema>;

export const ExecuteInputSchema = z.object({
  /** Function name as listed by get_schema (snake_case). */
  function: z.string(),
  /** Arguments conforming to this function's JSON Schema. The host validates them BEFORE dispatch. */
  args: z.record(z.unknown()),
}).strict();
export type ExecuteInput = z.infer<typeof ExecuteInputSchema>;

export const ExecuteOutputSchema = z.object({
  /** Arbitrary JSON-serialisable value. */
  result: z.unknown(),
  /** true if the plugin treated the call as an error — the host should translate this into an exception for the caller. */
  is_error: z.boolean().optional(),
  /** Human-readable message when is_error=true. */
  error_message: z.string().optional(),
});
export type ExecuteOutput = z.infer<typeof ExecuteOutputSchema>;

/** Hook metadata: dispatch class per hook (read by the registry). */
export const HOOK_DISPATCH = {
  get_schema: "broadcast_collect" as const,
  execute: "singleton" as const,
} as const;

/** MCP exposure: which hooks register automatically in an MCP server. */
export const HOOK_MCP_EXPOSED = {
  get_schema: false,
  execute: true,
} as const;

/** tool plugin contract — kind_api_version=1.0.0. */
export interface ToolPlugin {
  /**
   * Dispatch: broadcast_collect.
   *
   * List of JSON schemas for the functions the plugin exposes. A single
   * plugin may return several schemas (multi-tool plugin). The function
   * name inside a schema is globally unique within the plugin's namespace.
   */
  get_schema(payload: Empty): GetSchemaOutput;
  /**
   * Dispatch: singleton.
   *
   * Execute a tool with arguments. The arguments are validated against
   * the schema returned by get_schema (the host validates BEFORE
   * dispatching to the plugin). Singleton dispatch means that there must
   * be exactly one handler for each (kind, plugin_name, function_name).
   */
  execute(payload: ExecuteInput): ExecuteOutput;
}
