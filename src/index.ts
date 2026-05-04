/**
 * @dagstack/plugin-system — TypeScript runtime + spec-emitted types.
 *
 * Phase 0 shipped emitted kind contracts (`ToolV1`, `OrchestratorV1`).
 * Phase 1 (this version) adds the runtime: `PluginRegistry`, manifest
 * validation, and sentinel-style errors. Discovery, dispatchers, and
 * lifecycle land in subsequent Phase 1 PRs (TS-2/3/4 in epic
 * dagstack/plugin-system-typescript#9).
 */

export { VERSION } from "./version.js";

// ── Phase 1 runtime ────────────────────────────────────────────────────────
export {
  PluginRegistry,
  type PluginRegistryOptions,
  type SetupAllOptions,
} from "./registry.js";

export { ResourceRegistry, type PluginContext } from "./context.js";

export { topoSort } from "./lifecycle.js";

export {
  discover,
  type DiscoverOptions,
  type DiscoverResult,
  type DiscoveryFailure,
} from "./discovery.js";

export {
  type Dispatcher,
  type LoadedPlugin,
  orderForChain,
  STOP_CHAIN,
  type StopChain,
  SingletonDispatcher,
  BroadcastCollectDispatcher,
  BroadcastNotifyDispatcher,
  type BroadcastNotifyResult,
  ChainDispatcher,
  CapabilityDispatcher,
  type CapabilityRequirement,
} from "./dispatchers/index.js";

export {
  PluginManifestSchema,
  RuntimeKindSchema,
  ExecutionModelSchema,
  SUPPORTED_SCHEMA_VERSION,
  type PluginManifest,
  type PluginManifestInput,
  type RuntimeKind,
  type ExecutionModel,
} from "./manifest.js";

export {
  AmbiguousPlugin,
  DependencyCycle,
  KindUnknown,
  ManifestInvalid,
  MissingDependency,
  PluginLoadError,
  TeardownErrors,
  VersionIncompatible,
  isAmbiguousPlugin,
  isDependencyCycle,
  isKindUnknown,
  isManifestInvalid,
  isMissingDependency,
  isPluginLoadError,
  isTeardownErrors,
  isVersionIncompatible,
  type PluginErrorCode,
} from "./errors.js";

// ── Generated kind contracts (Phase 0) ─────────────────────────────────────
// Plugin authors import from here, not from @dagstack/plugin-system/_generated/* directly.
export * as ToolV1 from "./_generated/kinds/tool/v1.js";
export * as OrchestratorV1 from "./_generated/kinds/orchestrator/v1.js";
