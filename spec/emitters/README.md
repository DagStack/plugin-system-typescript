# Emitters

Emitters convert the source-of-truth YAML + JSON Schema from `kinds/` into language-native artifacts that consumers (`dagstack/plugin-system-python`, `dagstack/plugin-system-typescript`, ...) commit into their own repos as **generated** code.

## Overview

| Emitter | Output | Status (Phase 0) |
|---|---|---|
| [`python_pydantic.py`](python_pydantic.py) | pydantic v2 models + `Protocol` interface + dispatch metadata | working |
| `typescript_zod.ts` | zod schemas + `interface` + dispatch metadata | stub (Iter 6) |
| `openrpc.py` | OpenRPC json for MCP server tool registration | stub (Phase 1) |
| `markdown.py` | Human-readable kind/hook docs | stub (Phase 1) |

## How to use (as a consumer)

```bash
# In dagstack/plugin-system-python:
git submodule add https://github.com/dagstack/plugin-system-spec.git spec
make emit
# → spec/emitters/python_pydantic.py writes into src/dagstack/plugin_system/_generated/
git diff -- src/dagstack/plugin_system/_generated/    # MUST be empty (CI gate)
```

## CI gate in the spec repo

`emitters/python_pydantic.py --check /tmp/out` validates that generation passes without errors (for every YAML/schema). It does not write the finished output — only smoke-tests that the emitter works against the current kinds.

## Adding a new emitter

1. Create `<lang>_<framework>.py/.ts/.go` in this directory.
2. It MUST take as input a path to the `dagstack/plugin-system-spec` checkout (CWD-relative or via CLI argument) and an output directory.
3. It MUST be deterministic: the same input → bit-equal output (so the `git diff --exit-code` CI gate works in consumer repos).
4. Generated files MUST carry a header:
   ```
   # AUTO-GENERATED. Do not edit.
   # Source: dagstack/plugin-system-spec @ <git-sha>
   #         kinds/<kind>/v<N>.yaml
   ```

## Adding a new language

1. Create the emitter (see above).
2. Add `naming/<lang>.md` to the spec.
3. Create the `dagstack/plugin-system-<lang>` repo.
4. Inside it — a `Makefile` `emit` target that calls our emitter.
5. CI: `git diff --exit-code` after `make emit`.
