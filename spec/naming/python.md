# Python naming (plugin-system)

## Distribution names (PyPI flat namespace)

PyPI does not have scopes the way npm does — every name lives in one global
namespace. dagstack is an **umbrella brand**, plugin-system is one of the
products. Distribution names are product-scoped:

| Purpose | Package name | Example |
|---|---|---|
| Plugin-system core | `dagstack-plugin-system` | `pip install dagstack-plugin-system` |
| Spec helper (optional) | `dagstack-plugin-system-spec` | `pip install dagstack-plugin-system-spec` |
| Plugin: format `dagstack-plugin-system-<kind>-<name>` | `dagstack-plugin-system-vector-store-qdrant` | as is |
| Multi-plugin from a single maintainer | `dagstack-plugin-system-<vendor>-<name>` | `dagstack-plugin-system-acme-tools` |
| Other dagstack products | `dagstack-<product>` | `dagstack-governance`, `dagstack-training` |

> **Note:** the name `dagstack` (no suffix) is **reserved** for an umbrella
> meta-package (in case a single `pip install` for every product ever
> becomes desirable). It MUST NOT be used as the plugin-system core name —
> that violates the product-scoped principle.

## Import paths (PEP 420 namespace packages)

So that products from different distributions import under one
`dagstack.*` namespace, we use PEP 420 implicit namespace packages.

**Rule:** the root `src/dagstack/` MUST NOT contain `__init__.py`. Then any
distribution (`dagstack-plugin-system`, `dagstack-governance`, ...) can
place modules inside `dagstack/<product>/...`.

Likewise, `dagstack/plugin_system/plugins/` also has no `__init__.py` —
this lets plugins from different distributions coexist under the same
import path.

The plugin-system core layout (`dagstack-plugin-system` distribution):
```
src/dagstack/                       # ← NO __init__.py (namespace package)
└── plugin_system/                  # ← regular package
    ├── __init__.py
    ├── _version.py
    ├── manifest.py
    ├── registry.py
    ├── ...
    └── plugins/                    # ← NO __init__.py — namespace for plugins
```

A plugin package layout (`dagstack-plugin-system-vector-store-qdrant`):
```
src/dagstack/                       # ← NO __init__.py
└── plugin_system/                  # ← NO __init__.py (namespace, cross-distribution)
    └── plugins/                    # ← NO __init__.py
        └── vector_store/           # ← NO __init__.py (allow other plugins under same kind)
            └── qdrant/
                ├── __init__.py     # ← regular package; exports QdrantStore
                └── store.py
```

The plugin's `pyproject.toml`:
```toml
[project]
name = "dagstack-plugin-system-vector-store-qdrant"
dynamic = ["version"]

[tool.hatch.build.targets.wheel]
packages = ["src/dagstack"]    # PEP 420 — wheel contains the namespace package
```

## Registration point (entry_point)

Plugin discovery via `entry_points` in `pyproject.toml`:
```toml
[project.entry-points."dagstack.plugin_system.plugins"]
qdrant = "dagstack.plugin_system.plugins.vector_store.qdrant:QdrantStore"
```

The `dagstack.plugin_system.plugins` group is fixed — the host's
`PluginRegistry.discover_entry_points()` looks specifically for that group.

Alternative (without PEP 420 + entry_point) — manifest discovery via a
`dagstack-plugin.toml` file at the package root (requires `pkg_resources`
for location lookup, which is slower). Used for wheels that have no
entry_points.
