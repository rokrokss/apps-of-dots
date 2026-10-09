# Source provenance

The full Python MCP lives in [`server/`](server/) and the Go bridge in [`bridge/`](bridge/),
including their tests and dependency lockfiles. Setup builds these local sources and installs locked
libraries; it never clones or installs an external MCP.

| Item    | Imported baseline                                                                     |
| ------- | ------------------------------------------------------------------------------------- |
| Project | [verygoodplugins/whatsapp-mcp](https://github.com/verygoodplugins/whatsapp-mcp)       |
| Release | v0.7.0                                                                                |
| Commit  | `895404542017f34a900f9f572a5497c275a96440`                                            |
| Python  | 3.12; `server/uv.lock`, installed with `uv sync --frozen --no-dev`                    |
| Bridge  | Go 1.26+, CGO; `go build -mod=readonly`, `bridge/go.mod` and `go.sum`                 |
| Catalog | 17 tools, frozen definitions in `core/test/contracts/whatsapp.json`                   |
| License | MIT, Luke Harries / Very Good Plugins; [Python](server/LICENSE), [Go](bridge/LICENSE) |

The TypeScript supervisor adds private configuration, pairing, authenticated health gating and
process cleanup. A local change to `server/audio.py` validates configured media roots before audio
conversion and creates converted uploads beside the permitted input. Its regression tests live in
`server/tests/test_audio_roots.py`. The Go bridge only has whitespace cleanup. All original tool
schemas are preserved, including tools omitted from older project descriptions.

When changing either component, review the frozen tool contract and dependency locks and retain
license notices. Run `pnpm test`, `pnpm test:servers`, `pnpm check`, and `pnpm audit --prod`. Users
rerun `whatsapp install` after source changes; a fingerprint prevents stale installations. Keep
`whatsapp/data/store` outside source/runtime updates so the paired device and history persist.
