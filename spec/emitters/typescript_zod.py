#!/usr/bin/env python3
"""TypeScript emitter: kinds/<kind>/v<N>.yaml + schemas/*.json → zod + interface.

Mirror of `python_pydantic.py`: same source-of-truth, same CLI, but the output
targets TypeScript files for @dagstack/plugin-system. A single language
toolchain in the spec (Python for every emitter) is simpler than supporting
`tsc` alongside `pydantic`.

Output is code committed into the consumer repository. CI gate in the consumer
(plugin-system-typescript):
    npm run emit && git diff --exit-code

Usage:
    python emitters/typescript_zod.py --output /path/to/plugin-system-typescript/src/_generated
    python emitters/typescript_zod.py --check        # smoke: emit into /tmp, do not write
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

import yaml

SPEC_ROOT = Path(__file__).resolve().parent.parent

DISPATCH_CLASSES = {
    "singleton",
    "broadcast_collect",
    "broadcast_notify",
    "chain",
    "capability",
}


def load_dispatch_classes_from_meta() -> set[str]:
    meta_file = SPEC_ROOT / "_meta" / "dispatch_classes.yaml"
    data = yaml.safe_load(meta_file.read_text(encoding="utf-8"))
    return set(data["dispatch_classes"].keys())


def _ts_zod_for_schema(schema: dict[str, Any], type_name_hint: str = "") -> str:
    """JSON Schema → zod expression."""
    if "$ref" in schema:
        ref = schema["$ref"]
        if ref.startswith("#/$defs/"):
            return ref.split("/")[-1] + "Schema"
        return "z.unknown()"

    if "anyOf" in schema:
        parts = [_ts_zod_for_schema(s, type_name_hint) for s in schema["anyOf"]]
        if len(parts) == 2 and "z.null()" in parts:
            other = next(p for p in parts if p != "z.null()")
            return f"{other}.nullable()"
        return f"z.union([{', '.join(parts)}])"

    if "enum" in schema:
        values = ", ".join(json.dumps(v) for v in schema["enum"])
        return f"z.enum([{values}])"

    t = schema.get("type")
    if t == "object":
        if "properties" not in schema or not schema["properties"]:
            return "z.record(z.unknown())"
        return type_name_hint or "z.record(z.unknown())"
    if t == "array":
        return f"z.array({_ts_zod_for_schema(schema.get('items', {}), type_name_hint)})"
    if t == "string":
        if "pattern" in schema:
            return f"z.string().regex(/{schema['pattern']}/)"
        if schema.get("format") == "date-time":
            return "z.string().datetime()"
        return "z.string()"
    if t == "integer":
        return "z.number().int()"
    if t == "number":
        return "z.number()"
    if t == "boolean":
        return "z.boolean()"
    if t == "null":
        return "z.null()"
    return "z.unknown()"


def _emit_zod_schema(name: str, schema: dict[str, Any]) -> str:
    """Emit an exported zod schema + TS type."""
    zod_name = f"{name}Schema"

    if schema.get("type") == "array":
        inner = _ts_zod_for_schema(schema.get("items", {}))
        return (
            f"export const {zod_name} = z.array({inner});\n"
            f"export type {name} = z.infer<typeof {zod_name}>;\n"
        )

    if schema.get("type") != "object":
        return f"// {name}: non-object root not yet supported\n"

    properties = schema.get("properties", {})
    required = set(schema.get("required", []))
    strict = schema.get("additionalProperties") is False

    if not properties:
        return (
            f"export const {zod_name} = z.record(z.unknown());\n"
            f"export type {name} = z.infer<typeof {zod_name}>;\n"
        )

    parts = [f"export const {zod_name} = z.object({{"]
    for prop_name, prop_schema in properties.items():
        zod = _ts_zod_for_schema(prop_schema)
        if prop_name not in required:
            zod = f"{zod}.optional()"
        descr = prop_schema.get("description", "").strip().replace("\n", " ")
        if descr:
            parts.append(f"  /** {descr} */")
        parts.append(f"  {prop_name}: {zod},")
    if strict:
        parts.append("}).strict();")
    else:
        parts.append("});")

    parts.append(f"export type {name} = z.infer<typeof {zod_name}>;")
    return "\n".join(parts) + "\n"


def emit_kind(yaml_path: Path) -> str:
    spec = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    kind = spec["kind"]
    api_version = spec["kind_api_version"]
    description = spec.get("description", "").strip()
    hooks = spec.get("hooks", [])

    parts: list[str] = []
    parts.append(
        f"/**\n"
        f" * AUTO-GENERATED. Do not edit.\n"
        f" *\n"
        f" * Source: dagstack/plugin-system-spec — kinds/{kind}/v{api_version.split('.')[0]}.yaml\n"
        f" * Kind:   {kind}\n"
        f" * API:    {api_version}\n"
        f" *\n * "
        + description.replace("\n", "\n * ")
        + "\n */\n"
    )
    parts.append('import { z } from "zod";\n\n')
    parts.append(f'export const KIND_NAME = "{kind}" as const;\n')
    parts.append(f'export const KIND_API_VERSION = "{api_version}" as const;\n\n')

    schemas_dir = yaml_path.parent / "schemas"
    emitted: set[str] = set()
    hook_class_map: dict[str, dict[str, str]] = {}

    def _class_name(stem: str) -> str:
        bare = stem.replace(".json", "")
        return "".join(p.capitalize() for p in bare.replace(".", "_").split("_"))

    for hook in hooks:
        hook_name = hook["name"]
        hook_class_map[hook_name] = {}
        for slot in ("input_schema", "output_schema"):
            schema_rel = hook.get(slot)
            if not schema_rel:
                continue
            schema_path = (yaml_path.parent / schema_rel).resolve()
            if not schema_path.exists():
                raise FileNotFoundError(f"{schema_path}")

            schema = json.loads(schema_path.read_text(encoding="utf-8"))
            class_name = _class_name(schema_path.name)
            hook_class_map[hook_name][slot.replace("_schema", "")] = class_name

            if class_name in emitted:
                continue

            for def_name, def_schema in schema.get("$defs", {}).items():
                if def_name in emitted:
                    continue
                parts.append(_emit_zod_schema(def_name, def_schema))
                parts.append("\n")
                emitted.add(def_name)

            parts.append(_emit_zod_schema(class_name, schema))
            parts.append("\n")
            emitted.add(class_name)

    parts.append("/** Hook metadata: dispatch class per hook (read by the registry). */\n")
    parts.append("export const HOOK_DISPATCH = {\n")
    for hook in hooks:
        parts.append(f'  {hook["name"]}: "{hook["dispatch"]}" as const,\n')
    parts.append("} as const;\n\n")

    parts.append("/** MCP exposure: which hooks register automatically in an MCP server. */\n")
    parts.append("export const HOOK_MCP_EXPOSED = {\n")
    for hook in hooks:
        parts.append(f'  {hook["name"]}: {str(hook.get("mcp_exposed", True)).lower()},\n')
    parts.append("} as const;\n\n")

    iface_name = kind[0].upper() + kind[1:] + "Plugin"
    parts.append(f"/** {kind} plugin contract — kind_api_version={api_version}. */\n")
    parts.append(f"export interface {iface_name} {{\n")
    for hook in hooks:
        hook_name = hook["name"]
        input_class = hook_class_map[hook_name].get("input")
        output_class = hook_class_map[hook_name].get("output", "unknown")
        descr = hook.get("description", "").strip().replace("\n", "\n   * ")
        parts.append(f"  /**\n   * Dispatch: {hook['dispatch']}.\n   *\n   * {descr}\n   */\n")
        if input_class:
            parts.append(f"  {hook_name}(payload: {input_class}): {output_class};\n")
        else:
            parts.append(f"  {hook_name}(): {output_class};\n")
    parts.append("}\n")

    return "".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--output", type=Path)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if load_dispatch_classes_from_meta() != DISPATCH_CLASSES:
        print("ERROR: DISPATCH_CLASSES drift", file=sys.stderr)
        return 2

    if args.check:
        out_root = Path(tempfile.mkdtemp(prefix="dagstack-spec-emit-ts-"))
        print(f"--check mode: writing to {out_root}")
    else:
        if not args.output:
            ap.error("--output required (or use --check)")
        out_root = args.output

    n = 0
    for yaml_path in sorted((SPEC_ROOT / "kinds").glob("*/v*.yaml")):
        kind = yaml_path.parent.name
        version_major = yaml_path.stem
        out_dir = out_root / "kinds" / kind
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f"{version_major}.ts"
        try:
            content = emit_kind(yaml_path)
        except Exception as e:
            print(f"ERROR emitting {yaml_path}: {e}", file=sys.stderr)
            return 1
        content = content.rstrip("\n") + "\n"
        out_file.write_text(content, encoding="utf-8")
        print(f"  emitted: {out_file.relative_to(out_root)}  ({len(content)} bytes)")
        n += 1

    if n == 0:
        print("WARN: no kinds found", file=sys.stderr)
        return 1
    print(f"\nDone. Emitted {n} kind(s) to {out_root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
