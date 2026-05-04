#!/usr/bin/env python3
"""Python emitter: kinds/<kind>/v<N>.yaml + schemas/*.json → pydantic + Protocol.

Source-of-truth: the YAML describes kind + hooks + dispatch class + references
to the JSON Schemas for payloads. This script reads them and generates Python
files with pydantic v2 models, a `Protocol` class, and dispatch metadata.

Output is code committed into the consumer repository. CI gate in the consumer:
    make emit && git diff --exit-code

Usage:
    python emitters/python_pydantic.py --output /path/to/plugin-system-python/src/dagstack/plugin_system/_generated
    python emitters/python_pydantic.py --check        # smoke: emit into /tmp, do not write
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

# Closed enum of dispatch_classes; MUST match _meta/dispatch_classes.yaml.
DISPATCH_CLASSES = {
    "singleton",
    "broadcast_collect",
    "broadcast_notify",
    "chain",
    "capability",
}


def load_dispatch_classes_from_meta() -> set[str]:
    """Sanity check — the DISPATCH_CLASSES constant in this file must match the spec."""
    meta_file = SPEC_ROOT / "_meta" / "dispatch_classes.yaml"
    data = yaml.safe_load(meta_file.read_text(encoding="utf-8"))
    return set(data["dispatch_classes"].keys())


def _py_type_for_schema(schema: dict[str, Any], type_name_hint: str = "") -> str:
    """JSON Schema → Python type expression (for use in a hook signature).

    Minimal coverage: object, array, string, integer, number, boolean, null,
    $ref, enum, anyOf. Sufficient for the current kinds; extend as new kinds
    arrive.
    """
    if "$ref" in schema:
        # Local $ref into $defs — take the class name.
        ref = schema["$ref"]
        if ref.startswith("#/$defs/"):
            return ref.split("/")[-1]
        return "Any"  # external $ref — fallback

    if "anyOf" in schema:
        parts = [_py_type_for_schema(s, type_name_hint) for s in schema["anyOf"]]
        if "None" in parts and len(parts) == 2:
            other = next(p for p in parts if p != "None")
            return f"{other} | None"
        return " | ".join(parts)

    if "enum" in schema:
        # Literal type
        values = ", ".join(repr(v) for v in schema["enum"])
        return f"Literal[{values}]"

    t = schema.get("type")
    if t == "object":
        if "properties" not in schema or not schema["properties"]:
            return "dict[str, Any]"
        return type_name_hint or "dict[str, Any]"
    if t == "array":
        items = schema.get("items", {})
        return f"list[{_py_type_for_schema(items, type_name_hint)}]"
    if t == "string":
        return "str"
    if t == "integer":
        return "int"
    if t == "number":
        return "float"
    if t == "boolean":
        return "bool"
    if t == "null":
        return "None"
    return "Any"


def _emit_pydantic_class(class_name: str, schema: dict[str, Any]) -> str:
    """Emit a pydantic v2 BaseModel from an object-schema."""
    if schema.get("type") != "object":
        return ""

    lines = [f"class {class_name}(BaseModel):"]
    docstring = schema.get("description") or schema.get("title")
    if docstring:
        d = docstring.replace('"', "'").strip().replace("\n", " ")
        lines.append(f'    """{d}"""')

    if schema.get("additionalProperties") is False:
        lines.append("    model_config = ConfigDict(extra='forbid')")
        lines.append("")

    properties = schema.get("properties", {})
    required = set(schema.get("required", []))

    if not properties:
        lines.append("    pass")
        return "\n".join(lines) + "\n"

    for prop_name, prop_schema in properties.items():
        py_type = _py_type_for_schema(prop_schema)
        is_required = prop_name in required
        if is_required:
            field = f"    {prop_name}: {py_type}"
        else:
            default = prop_schema.get("default")
            if default is None:
                field = f"    {prop_name}: {py_type} | None = None"
            elif isinstance(default, str):
                field = f"    {prop_name}: {py_type} = {default!r}"
            elif isinstance(default, (int, float, bool)):
                field = f"    {prop_name}: {py_type} = {default}"
            elif isinstance(default, list):
                field = f"    {prop_name}: {py_type} = Field(default_factory=list)"
            elif isinstance(default, dict):
                field = f"    {prop_name}: {py_type} = Field(default_factory=dict)"
            else:
                field = f"    {prop_name}: {py_type}"

        prop_descr = prop_schema.get("description")
        if prop_descr:
            d = prop_descr.replace('"', "'").strip().replace("\n", " ")
            lines.append(f"    # {d}")
        lines.append(field)

    return "\n".join(lines) + "\n"


def _hook_signature(hook: dict[str, Any], input_class: str, output_class: str) -> str:
    """Emit a hook method signature for a Protocol class."""
    name = hook["name"]
    dispatch = hook["dispatch"]
    descr = hook.get("description", "").strip().replace("\n", "\n    ")

    # Singleton/broadcast_notify/chain are sync methods; broadcast_collect returns
    # a list. The return type here is "what one plugin instance returns"; the
    # host aggregates results into a list.
    if input_class:
        sig = f"    def {name}(self, payload: {input_class}) -> {output_class}:"
    else:
        sig = f"    def {name}(self) -> {output_class}:"

    body = [
        sig,
        f'        """Dispatch: {dispatch}.',
        f"        ",
        f"        {descr}",
        f'        """',
        "        ...",
    ]
    return "\n".join(body)


def emit_kind(yaml_path: Path) -> str:
    """Emit a Python module for a single kinds/<kind>/v<N>.yaml."""
    spec = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    kind = spec["kind"]
    api_version = spec["kind_api_version"]
    description = spec.get("description", "").strip()
    hooks = spec.get("hooks", [])

    parts: list[str] = []
    parts.append(
        f'"""AUTO-GENERATED. Do not edit.\n'
        f"\n"
        f"Source: dagstack/plugin-system-spec — kinds/{kind}/v{api_version.split('.')[0]}.yaml\n"
        f"Kind:   {kind}\n"
        f"API:    {api_version}\n"
        f"\n"
        f"{description}\n"
        f'"""\n'
    )
    parts.append("from __future__ import annotations\n")
    parts.append("from typing import Any, Literal, Protocol, runtime_checkable\n")
    parts.append("from pydantic import BaseModel, ConfigDict, Field\n")
    parts.append("\n")
    parts.append(f'KIND_NAME = "{kind}"\n')
    parts.append(f'KIND_API_VERSION = "{api_version}"\n')
    parts.append("\n")

    # Pydantic classes for every unique schema (input + output of each hook).
    schemas_dir = yaml_path.parent / "schemas"
    emitted_classes: set[str] = set()

    def _class_name_for_schema_file(name: str) -> str:
        """get_schema.output.json -> GetSchemaOutput. execute.input.json -> ExecuteInput."""
        stem = name.replace(".json", "")
        camel = "".join(part.capitalize() for part in stem.replace(".", "_").split("_"))
        return camel

    hook_class_map: dict[str, dict[str, str]] = {}  # hook_name -> {input, output}

    for hook in hooks:
        hook_name = hook["name"]
        hook_class_map[hook_name] = {}
        for slot in ("input_schema", "output_schema"):
            schema_rel = hook.get(slot)
            if not schema_rel:
                continue
            schema_path = (yaml_path.parent / schema_rel).resolve()
            if not schema_path.exists():
                raise FileNotFoundError(f"Missing schema {schema_path} for {kind}.{hook_name}.{slot}")

            schema = json.loads(schema_path.read_text(encoding="utf-8"))
            class_name = _class_name_for_schema_file(schema_path.name)
            hook_class_map[hook_name][slot.replace("_schema", "")] = class_name

            if class_name in emitted_classes:
                continue

            # $defs first
            for def_name, def_schema in schema.get("$defs", {}).items():
                if def_name in emitted_classes:
                    continue
                parts.append(_emit_pydantic_class(def_name, def_schema))
                parts.append("\n")
                emitted_classes.add(def_name)

            # Top-level
            if schema.get("type") == "array":
                items = schema.get("items", {})
                inner = _py_type_for_schema(items)
                parts.append(f"# Top-level type alias for {class_name}\n")
                parts.append(f"{class_name} = list[{inner}]\n\n")
            elif schema.get("type") == "object":
                # Empty object → no class needed; reference by NoneType
                if not schema.get("properties"):
                    parts.append(f"# {class_name}: empty object — no payload\n")
                    parts.append(f"{class_name} = dict[str, Any]\n\n")
                else:
                    parts.append(_emit_pydantic_class(class_name, schema))
                    parts.append("\n")
            emitted_classes.add(class_name)

    # Hook metadata + Protocol class.
    parts.append("# Hook metadata: dispatch class per hook (read by the registry).\n")
    parts.append("HOOK_DISPATCH: dict[str, str] = {\n")
    for hook in hooks:
        parts.append(f'    "{hook["name"]}": "{hook["dispatch"]}",\n')
    parts.append("}\n\n")

    parts.append(f"# MCP exposure: which hooks register automatically in an MCP server.\n")
    parts.append("HOOK_MCP_EXPOSED: dict[str, bool] = {\n")
    for hook in hooks:
        parts.append(f'    "{hook["name"]}": {hook.get("mcp_exposed", True)!r},\n')
    parts.append("}\n\n")

    parts.append("@runtime_checkable\n")
    parts.append(f"class {kind.capitalize()}Plugin(Protocol):\n")
    parts.append(f'    """{kind} plugin contract — kind_api_version={api_version}."""\n\n')
    for hook in hooks:
        hook_name = hook["name"]
        input_class = hook_class_map[hook_name].get("input", "")
        output_class = hook_class_map[hook_name].get("output", "Any")
        parts.append(_hook_signature(hook, input_class, output_class))
        parts.append("\n\n")

    return "".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument(
        "--output",
        type=Path,
        help="Output dir (consumer's _generated/). Skipped if --check.",
    )
    ap.add_argument(
        "--check",
        action="store_true",
        help="Smoke: emit into tmpdir, do not write. Use in spec CI.",
    )
    args = ap.parse_args()

    # Sanity: DISPATCH_CLASSES in this script matches the spec.
    spec_dispatch = load_dispatch_classes_from_meta()
    if spec_dispatch != DISPATCH_CLASSES:
        print(f"ERROR: DISPATCH_CLASSES drift — script={DISPATCH_CLASSES} spec={spec_dispatch}", file=sys.stderr)
        return 2

    if args.check:
        out_root = Path(tempfile.mkdtemp(prefix="dagstack-spec-emit-"))
        print(f"--check mode: writing to {out_root}")
    else:
        if not args.output:
            ap.error("--output required (or use --check)")
        out_root = args.output

    kinds_dir = SPEC_ROOT / "kinds"
    n_emitted = 0
    for yaml_path in sorted(kinds_dir.glob("*/v*.yaml")):
        kind = yaml_path.parent.name
        version_major = yaml_path.stem  # "v1"
        out_dir = out_root / "kinds" / kind
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f"{version_major}.py"

        try:
            content = emit_kind(yaml_path)
        except Exception as e:
            print(f"ERROR emitting {yaml_path}: {e}", file=sys.stderr)
            return 1

        # Guarantee exactly one trailing newline — otherwise pre-commit end-of-file-fixer
        # drifts generated files and the CI gate `git diff --exit-code` fails.
        content = content.rstrip("\n") + "\n"
        out_file.write_text(content, encoding="utf-8")
        print(f"  emitted: {out_file.relative_to(out_root)}  ({len(content)} bytes)")
        n_emitted += 1

    if n_emitted == 0:
        print("WARN: no kinds found", file=sys.stderr)
        return 1

    print(f"\nDone. Emitted {n_emitted} kind(s) to {out_root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
