# Kind taxonomy

A plugin's `kind` is the category that determines its hookspec (available hooks, dispatch semantics, payload schema). A core MAY load only plugins whose kinds it knows (see `core_version` ↔ supported kinds in the core).

## Current set of kinds

| Kind | Spec file | API version | Description |
|---|---|---|---|
| [`tool`](tool/v1.yaml) | `kinds/tool/v1.yaml` | 1.0.0 | Function-style plugin: one or more executable hooks. A close cousin of the OpenAI/MCP "tool" concept. |
| [`orchestrator`](orchestrator/v1.yaml) | `kinds/orchestrator/v1.yaml` | 1.0.0 | Runs unit-of-work plugins with lifecycle and checkpointing. See DST-0003. |

## Future kinds (Phase 1+)

From ADR-0001 §Implementation plan, ADR-0003 §Additions, and ADR-0005 §Content sources:

| Kind | Status | Purpose |
|---|---|---|
| `embedder` | planned | LLM embeddings provider (OpenAI / VoyageAI / local / ...). |
| `vector_store` | planned | Qdrant / Chroma / pgvector / in-memory. |
| `chunker` | planned | Splits files/documents into chunks (Tree-sitter / fallback / document-aware). |
| `llm_client` | planned | Chat completion provider (OpenAI-compat / Anthropic native / local). |
| `pipeline` | planned | RAG pipeline strategy (Simple / Agent / Two-Agent / custom). |
| `agent_tool` | planned | A tool in OpenAI function-calling style (separate from the generic `tool`). |
| `vcs_source` | planned | Git/Bitbucket/Gitea adapter for source code (DST-0005 ⊂ blob_source). |
| `blob_source` | planned | FS / S3 / etc., a generic blob source. |
| `document_source` | planned | Confluence / Jira / etc. for documents. |
| `content_renderer` | planned | Converts a raw blob → text / markdown for downstream chunking. |

Adding a new kind = a new ADR + `kinds/<kind>/v1.yaml` + emitter support for the new file.

## Layout of one kind

```
kinds/<kind>/
├── v1.yaml              # current major
├── v1/schemas/          # JSON Schema for input/output payloads
│   ├── empty.json       # for hooks with no arguments
│   ├── execute.input.json
│   └── execute.output.json
├── v2.yaml              # (future) after a major bump
├── v2/schemas/
└── README.md            # human description (Phase 1+)
```

On a major bump (`v1` → `v2`), the old file is NOT removed. A core MAY support both at once through a legacy compat shim.
