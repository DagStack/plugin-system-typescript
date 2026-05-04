# Go naming (plugin-system)

Go does not have a centralized package registry (the way PyPI/npm do). The module path is the public URL of a git repo. We use a **vanity import path** under our domain `dagstack.dev`. The product name (`plugin-system`, `governance`, ...) is part of the path:

## Distribution names (vanity import paths)

Module path | Backing repo | Usage
---|---|---
`go.dagstack.dev/plugin-system` | `github.com/dagstack/plugin-system-go` | `go get go.dagstack.dev/plugin-system`
`go.dagstack.dev/plugin-system-spec` | `github.com/dagstack/plugin-system-spec` (or a generated subdir) | `go get go.dagstack.dev/plugin-system-spec`
`go.dagstack.dev/plugin-system/plugins/vector-store-qdrant` | `github.com/dagstack/plugin-system-go-vector-store-qdrant` | `go get go.dagstack.dev/plugin-system/plugins/vector-store-qdrant`

## Vanity setup

`go get go.dagstack.dev/plugin-system` hits `https://go.dagstack.dev/plugin-system?go-get=1` and expects HTML with a meta-tag:

```html
<!DOCTYPE html>
<html>
<head>
  <meta name="go-import" content="go.dagstack.dev/plugin-system git https://github.com/dagstack/plugin-system-go.git">
  <meta name="go-source" content="go.dagstack.dev/plugin-system
                                  https://github.com/dagstack/plugin-system-go
                                  https://github.com/dagstack/plugin-system-go/tree/main{/dir}
                                  https://github.com/dagstack/plugin-system-go/blob/main{/dir}/{file}#L{line}">
</head>
<body>
  Redirect: <a href="https://github.com/dagstack/plugin-system-go">github.com/dagstack/plugin-system-go</a>
</body>
</html>
```

One such HTML per module — static content on `go.dagstack.dev` (for example, served by nginx). This is the standard Go practice followed by `gocloud.dev`, `k8s.io`, and `gopkg.in`.

## Import paths in code

```go
import (
    dagstack "go.dagstack.dev/plugin-system"
    "go.dagstack.dev/plugin-system/manifest"
    "go.dagstack.dev/plugin-system/plugins/vector-store-qdrant"
)
```

## Layout of `go.dagstack.dev/plugin-system`

```
plugin-system-go/
├── go.mod              # module go.dagstack.dev/plugin-system
├── manifest/           # subpackage — go.dagstack.dev/plugin-system/manifest
│   ├── manifest.go
│   └── manifest_test.go
├── registry/           # go.dagstack.dev/plugin-system/registry
├── kinds/
│   └── tool/v1/
│       └── tool.go     # generated from the spec
└── _generated/         # parallel to Python/TS
```

## Plugin registration

Go has no dynamic discovery comparable to Python entry_points / npm scopes — every plugin is registered explicitly in host code:

```go
import (
    dagstack "go.dagstack.dev/plugin-system"
    qdrant "go.dagstack.dev/plugin-system/plugins/vector-store-qdrant"
)

func main() {
    reg := dagstack.NewRegistry()
    reg.Register(qdrant.New())
    reg.SetupAll()
}
```

Alternative — auto-discovery via a `dagstack-plugin.toml` next to each plugin's `go.mod` plus build-time codegen of a registration file. A Phase 1+ decision.

## What needs to be set up (TODO)

- [ ] DNS: A record `go.dagstack.dev` → host serving the static content.
- [ ] Nginx serves `<root>/<package>/index.html` with the correct `Content-Type`.
- [ ] Generator script: from a list of known modules → set of HTML files.
- [ ] CI in `dagstack/plugin-system-spec`: when a new known package is added, apply changes to the vanity host.

Pre-Phase-1 — the Go module path MAY use `github.com/dagstack/plugin-system-go` directly (no vanity). The vanity setup is done before the public release.
