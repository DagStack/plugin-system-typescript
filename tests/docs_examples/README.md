# docs_examples — auto-tests for `dagstack-plugin-system-docs` snippets

Each test file mirrors a single MDX page in
[`dagstack/plugin-system-docs`](https://github.com/dagstack/plugin-system-docs)
and copies the page's TypeScript `<TabItem value="typescript">` snippet
between the markers `// --- snippet start ---` / `// --- snippet end ---`.
Assertions sit outside the markers and verify behaviour the surrounding
prose claims.

## Why a dedicated directory

The MDX snippets are user-facing examples. Keeping them in their own
directory avoids leaking `import` style or one-off patterns into
`tests/*.test.ts`, which follows the unit-test style.

## Coverage scope

The `0.1.0-rc.2` package exports only spec-emitted types — `VERSION`,
`ToolV1`, `OrchestratorV1`. Pages whose TypeScript snippets reference the
runtime (`PluginRegistry`, `discover`, dispatchers, contract suite) carry
a "Phase 1" admonition in the docs and intentionally have **no test
mirror here** — there is nothing to test until the runtime ships.

| Test file | MDX page | Status |
| --- | --- | --- |
| `intro.test.ts` | `site/docs/intro.mdx` | covers `VERSION` + `ToolV1.ToolPlugin` snippet only |

Other MDX pages (`concepts/*`, `guides/*`, `spec/adr/*`) have their TS
TabItems replaced with the Phase 1 admonition; they will gain tests in
this directory once the runtime lands.

## Coverage gate

A future `make docs-audit` step (PS-7.8) will mechanically check that
every MDX page with a non-admonition TypeScript TabItem has a matching
test file here.
