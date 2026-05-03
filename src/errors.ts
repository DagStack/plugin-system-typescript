/**
 * Sentinel-style errors for the plugin-system runtime.
 *
 * Each error class is constructable directly and exposes a stable `code`
 * field, mirroring the Go binding's `errors.Is(err, ErrAmbiguousPlugin)`
 * pattern. Consumers may discriminate either by `instanceof` or by the
 * `is<Name>(err)` type-guard helpers exported alongside.
 *
 * The Python binding declares the equivalent exceptions in
 * `dagstack.plugin_system.errors`. Names match for cross-binding parity.
 */

const ERROR_CODE = Symbol.for("dagstack.plugin_system.errorCode");

export type PluginErrorCode =
  | "AmbiguousPlugin"
  | "KindUnknown"
  | "ManifestInvalid"
  | "VersionIncompatible"
  | "PluginLoadError"
  | "DependencyCycle"
  | "MissingDependency"
  | "TeardownErrors";

abstract class PluginSystemError extends Error {
  abstract readonly [ERROR_CODE]: PluginErrorCode;

  get code(): PluginErrorCode {
    return this[ERROR_CODE];
  }
}

export class AmbiguousPlugin extends PluginSystemError {
  readonly [ERROR_CODE] = "AmbiguousPlugin" as const;
  constructor(
    public readonly kind: string,
    public readonly candidates: ReadonlyArray<string>,
  ) {
    super(
      `Ambiguous plugin selection for kind=${kind}: candidates ${candidates.join(", ")} share the same priority. ` +
        `Resolve by setting an explicit override (env DAGSTACK_ACTIVE_${kind.toUpperCase()}) or distinct priorities.`,
    );
    this.name = "AmbiguousPlugin";
  }
}

export class KindUnknown extends PluginSystemError {
  readonly [ERROR_CODE] = "KindUnknown" as const;
  constructor(public readonly kind: string) {
    super(`No plugins registered for kind=${kind}.`);
    this.name = "KindUnknown";
  }
}

export class ManifestInvalid extends PluginSystemError {
  readonly [ERROR_CODE] = "ManifestInvalid" as const;
  constructor(
    message: string,
    public readonly source: string,
    public readonly issues?: ReadonlyArray<{ path: string; message: string }>,
  ) {
    super(`Invalid manifest [${source}]: ${message}`);
    this.name = "ManifestInvalid";
  }
}

export class VersionIncompatible extends PluginSystemError {
  readonly [ERROR_CODE] = "VersionIncompatible" as const;
  constructor(
    public readonly pluginName: string,
    public readonly requiredCoreRange: string,
    public readonly actualCoreVersion: string,
  ) {
    super(
      `Plugin ${pluginName} requires core_version ${requiredCoreRange}, ` +
        `but the runtime is ${actualCoreVersion}.`,
    );
    this.name = "VersionIncompatible";
  }
}

export class PluginLoadError extends PluginSystemError {
  readonly [ERROR_CODE] = "PluginLoadError" as const;
  constructor(
    public readonly pluginName: string,
    cause: unknown,
  ) {
    super(`Failed to load plugin ${pluginName}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "PluginLoadError";
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

export class DependencyCycle extends PluginSystemError {
  readonly [ERROR_CODE] = "DependencyCycle" as const;
  constructor(public readonly cycle: ReadonlyArray<string>) {
    super(`Plugin dependency cycle detected: ${cycle.join(" → ")} → ${cycle[0]}`);
    this.name = "DependencyCycle";
  }
}

export class MissingDependency extends PluginSystemError {
  readonly [ERROR_CODE] = "MissingDependency" as const;
  constructor(
    public readonly pluginName: string,
    public readonly missing: string,
  ) {
    super(`Plugin ${pluginName} depends on ${missing}, which is not registered.`);
    this.name = "MissingDependency";
  }
}

export class TeardownErrors extends PluginSystemError {
  readonly [ERROR_CODE] = "TeardownErrors" as const;
  constructor(public readonly errors: ReadonlyArray<{ name: string; error: unknown }>) {
    super(
      `${errors.length} plugin(s) raised during teardown: ${errors
        .map((e) => `${e.name} (${describeError(e.error)})`)
        .join("; ")}`,
    );
    this.name = "TeardownErrors";
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function hasCode(err: unknown, expected: PluginErrorCode): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    ERROR_CODE in err &&
    (err as Record<symbol, unknown>)[ERROR_CODE] === expected
  );
}

export const isAmbiguousPlugin = (err: unknown): err is AmbiguousPlugin =>
  hasCode(err, "AmbiguousPlugin");

export const isKindUnknown = (err: unknown): err is KindUnknown =>
  hasCode(err, "KindUnknown");

export const isManifestInvalid = (err: unknown): err is ManifestInvalid =>
  hasCode(err, "ManifestInvalid");

export const isVersionIncompatible = (err: unknown): err is VersionIncompatible =>
  hasCode(err, "VersionIncompatible");

export const isPluginLoadError = (err: unknown): err is PluginLoadError =>
  hasCode(err, "PluginLoadError");

export const isDependencyCycle = (err: unknown): err is DependencyCycle =>
  hasCode(err, "DependencyCycle");

export const isMissingDependency = (err: unknown): err is MissingDependency =>
  hasCode(err, "MissingDependency");

export const isTeardownErrors = (err: unknown): err is TeardownErrors =>
  hasCode(err, "TeardownErrors");
