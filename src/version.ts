/**
 * Single source of truth for the package version. Imported by both the
 * public API (`./index.ts`) and the registry's `defaultCoreVersion()`,
 * so that bumping a release touches one constant.
 */

export const VERSION = "0.2.1" as const;
