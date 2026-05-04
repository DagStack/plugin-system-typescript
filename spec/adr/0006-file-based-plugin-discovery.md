# ADR-0006: File-based plugin discovery — `discover(path)` + `dagstack.toml`

- **Status:** accepted v1.0
- **Date:** 2026-04-17
- **Architect review:** ai-systems-architect (single round, 2026-04-17)
- **Supersedes:** —
- **Related:** ADR-0001 (plugin architecture core, §Discovery), ADR-0004 (hookspec formalism)

## Context

ADR-0001 defines two discovery mechanisms:
1. `register_module(module)` — in-tree, a Python module with a `DAGSTACK_PLUGIN_MANIFEST` dict.
2. `load_entry_points(group)` — pip-installed, through `importlib.metadata`.

Both require an explicit call from the host for each plugin or a pip install. In practice (the pilot consumer) plugins live in directories inside the project:

```
plugins/
├── llm/openai_compatible/
│   ├── dagstack.toml
│   └── plugin.py
├── chunker/semantic/
│   ├── dagstack.toml
│   └── plugin.py
└── tool/semantic_search/
    ├── dagstack.toml
    └── plugin.py
```

Adding a plugin = creating a folder with `dagstack.toml` + `plugin.py`. No edits to the registry, factory, or imports. Removal = deleting the folder.

**Problem:** dagstack-plugin-system has no mechanism for scanning a directory and automatically loading plugins from TOML manifests. The host has to write boilerplate discovery code (the bridge pattern from the pilot consumer's PR #38-#46).

### Requirements

1. **Declarative.** The plugin is fully described by `dagstack.toml` + a Python module. No registration boilerplate.
2. **Convention over configuration.** Standard structure: `dagstack.toml` at the plugin directory root, `entry_point` is a REQUIRED field.
3. **Composability.** Multiple `plugin_dirs` — project + pip-installed + user-local.
4. **Multi-language.** The `dagstack.toml` format MUST work for Python, TypeScript, and Go.
5. **Namespace isolation.** Plugins are loaded through `importlib` without `sys.path` pollution.
6. **Hot-reload (Phase 2+).** The structure MUST support watch + reload without restarting the host (dev mode).

## Decision

### 1. `dagstack.toml` — canonical plugin manifest file

Every plugin MUST have `dagstack.toml` in its root directory. `entry_point` is a REQUIRED field.

```toml
[plugin]
name = "openai_compatible"
kind = "llm"
runtime = "in_process"
entry_point = "plugin:OpenAIPlugin"       # REQUIRED
priority = 0
core_version = ">=0.2.0"

[plugin.resources]
required = ["config"]
optional = ["http_client"]

[plugin.metadata]
description = "OpenAI-compatible LLM backend (OpenRouter, vLLM, Ollama)"
author = "dagstack"
license = "Apache-2.0"
```

**The format is shared** between folder-based discovery and pip packages. Pip-installed plugins ship `dagstack.toml` as package data; `load_entry_points()` MAY locate it through `importlib.resources`.

**Kind — opaque string.** Plugin-system does not validate the `kind` value; that is the host's responsibility. Plugin-system stores and groups by kind, but does not assign semantics.

### 2. Entry-point resolution through importlib (no sys.path)

`entry_point` is resolved **relative to the plugin directory** through `importlib.util.spec_from_file_location` — without manipulating `sys.path`:

```
plugins/llm/openai_compatible/
├── dagstack.toml          # entry_point = "plugin:OpenAIPlugin"
└── plugin.py              # loaded as dagstack._discovered.openai_compatible.plugin
```

Resolution algorithm:
1. `entry_point = "module:ClassName"` — REQUIRED format.
2. `module` = the `.py` file name (without extension) inside the plugin directory.
3. The file is loaded through `importlib.util.spec_from_file_location` into the isolated namespace `dagstack._discovered.{plugin_name}.{module}`.
4. `ClassName` is extracted via `getattr(loaded_module, class_name)`.

```python
import importlib.util
import sys

def _load_entry_point(plugin_dir: Path, plugin_name: str, entry_point: str) -> type:
    module_name, class_name = entry_point.split(":")
    file_path = plugin_dir / f"{module_name}.py"
    if not file_path.is_file():
        raise ManifestInvalid(f"Entry point module not found: {file_path}")

    qualified = f"dagstack._discovered.{plugin_name}.{module_name}"
    spec = importlib.util.spec_from_file_location(qualified, file_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[qualified] = mod
    spec.loader.exec_module(mod)
    return getattr(mod, class_name)
```

Namespace isolation: each `plugin.py` lives at `dagstack._discovered.{name}.plugin` — collisions are impossible even if every plugin uses `plugin.py`.

### 3. `PluginRegistry.discover(path, *, recursive=True)`

A new public method:

```python
def discover(
    self,
    path: str | Path,
    *,
    recursive: bool = True,
    ignore: list[str] | None = None,
) -> list[PluginManifest]:
    """Scan directory for dagstack.toml manifests and register found plugins.

    Args:
        path: Root directory to scan.
        recursive: If True, scan subdirectories (default). Each directory
            containing dagstack.toml is treated as a plugin leaf.
        ignore: Directory names to skip (default: ["__pycache__", ".git",
            "node_modules", ".venv"]).

    Returns:
        List of successfully registered manifests.

    Raises:
        Nothing — invalid manifests are logged and skipped (continue-on-failure).
    """
```

Algorithm:
1. Walk `path` recursively.
2. Collect every directory containing `dagstack.toml` (stop recursion into them — a plugin is a leaf).
3. Parse all manifests. Check for duplicate names — raise `ManifestInvalid` on collision (same behavior as `_register`).
4. Sort by `depends_on` (topo order) for the correct load sequence.
5. For each manifest in topo order:
   - Resolve `entry_point` via `importlib` (Section 2).
   - Call `self._register(manifest)`.
   - Log success or skip on failure (continue-on-failure).
6. Return the list of successfully registered manifests.

### 4. Host-side usage

`discover()` takes an explicit path. The source of that path (hardcoded, config file, CLI argument) is the host's responsibility:

```python
# Minimal Python API:
registry = PluginRegistry()
registry.discover("plugins/")                    # project plugins
registry.discover("~/.dagstack/plugins/")        # user plugins (optional)
registry.load_entry_points()                     # pip-installed plugins
```

`discover()` does not read configuration. The conventional config key `dagstack.plugin_dirs` is defined in dagstack/config-spec, not here.

### 5. Directory structure conventions

```
plugins/                           # plugin_dir
├── {category}/                    # optional grouping (not semantic)
│   └── {plugin_name}/            # plugin root
│       ├── dagstack.toml         # REQUIRED
│       ├── plugin.py             # entry_point module (name from manifest)
│       ├── tests/                # plugin-local tests (optional)
│       └── README.md             # plugin docs (optional)
└── {plugin_name}/                # flat structure also valid
    ├── dagstack.toml
    └── plugin.py
```

- Category directories (`llm/`, `tool/`, `chunker/`) — human-oriented grouping. The `kind` is taken from `dagstack.toml`, not from the path.
- The plugin directory name SHOULD match `name` in the manifest for readability, but it is not required.
- `tests/` inside a plugin dir — for plugin-local contract tests.

### 6. Interaction with existing discovery mechanisms

| Mechanism | Use case | Priority |
|---|---|---|
| `discover(path)` | In-project plugins, folder-based | Primary for applications |
| `register_module(mod)` | Programmatic registration, bridges, testing | Fallback |
| `load_entry_points()` | pip-installed plugins | Secondary, distribution |

All three mechanisms register into the same `PluginRegistry`. Duplicate names — error (`ManifestInvalid`), not override.

## Consequences

### Positive

- **Zero-boilerplate** plugin addition: create a folder → done.
- **Namespace isolation**: importlib loading, no sys.path pollution.
- **A single manifest format** (`dagstack.toml`) for folder-based and pip packages.
- **Hot-reload ready**: directory watcher + re-discover = dev mode (Phase 2+).
- **Testability**: plugin-local `tests/` with the contract-test framework.

### Negative

- **importlib loading**: a plugin cannot make relative imports between modules in its own directory without `__init__.py` and proper package setup. Mitigation: a plugin = a single module (`plugin.py`); complex plugins ship as pip packages.
- **No dependency resolution between plugins discovered in different directories**: `depends_on` works inside a single `discover()` call (topo-sort). Across multiple `discover()` calls, the call order determines priority.
- **Security**: auto-discover = auto-execute. Mitigation: the `ignore` parameter; a future ADR on plugin signing.

### Migration path

1. **Existing projects** (the pilot consumer): bridge pattern → gradually move plugins into `plugins/` with `dagstack.toml`. The bridge pattern is documented as a "Migration Guide" in the dagstack docs.
2. **New projects**: folder-based structure from day one, `registry.discover("plugins/")` in the lifespan.

## Resolved questions (from architect review)

1. **Namespace isolation**: importlib-based loading (Phase 1), not `sys.path`. Resolved — see Section 2.
2. **Entry-point magic**: removed. `entry_point` is a REQUIRED field in `dagstack.toml`.
3. **Duplicate names**: error (`ManifestInvalid`), not override. Existing registry behavior preserved.
4. **Kind semantics**: opaque string, host-defined. Plugin-system does not validate.

## Open questions

1. **Remote plugins**: `discover()` works only with local files. A remote plugin catalog (HTTP registry) is a separate ADR.
2. **Plugin versioning**: `dagstack.toml` does not carry the plugin's own version. Is a `version` field needed for upgrade/rollback? Phase 2.
3. **Multi-module plugins**: a single `plugin.py` is restrictive for complex plugins. Complex plugins → pip package + entry_points. Phase 2 MAY add `__init__.py` support.
