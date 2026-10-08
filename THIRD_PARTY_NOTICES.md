# Third-party notices

This repository includes complete MCP implementations derived from the projects below. Their
licenses remain in each source directory; modifications are described in each `UPSTREAM.md`. General
dependency licenses remain in installed packages. The official OpenAI tunnel-client is installed
separately with its own notices. This repository's MIT license does not replace the Apache-2.0
license of the imported Telegram code.

Included sources:

- [PaSympa/discord-mcp](https://github.com/PaSympa/discord-mcp) at
  `5d13fea701d567f1c67a4f21f75844db1f1acda4`: MIT, copyright 2026 Léandre Moreau. Source and
  license: [`discord/server`](discord/server/).
- [chigwell/telegram-mcp](https://github.com/chigwell/telegram-mcp) at
  `87b38d3c453fbf6bb516259732296d5b6fcda376`: Apache-2.0, by chigwell and l1v0n1. Source and
  license: [`telegram/server`](telegram/server/).
- [verygoodplugins/whatsapp-mcp](https://github.com/verygoodplugins/whatsapp-mcp) at
  `895404542017f34a900f9f572a5497c275a96440`: MIT, original work Copyright (c) 2025 Luke Harries;
  modifications Copyright (c) 2026 Very Good Plugins. The compiled bridge also includes dependencies
  such as whatsmeow under their respective licenses. Source, licenses and module lockfiles:
  [`whatsapp/server`](whatsapp/server/) and [`whatsapp/bridge`](whatsapp/bridge/).

See [Discord provenance](discord/UPSTREAM.md), [Telegram provenance](telegram/UPSTREAM.md) and
[WhatsApp provenance](whatsapp/UPSTREAM.md). Installers build local code without fetching those MCP
repositories or packages.

## PaSympa/discord-mcp

MIT License

Copyright (c) 2026 Léandre Moreau

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
