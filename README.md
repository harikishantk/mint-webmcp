# mint-webmcp

Headless **WebMCP-style** tools for the long tail of the web: attach a URL, **mint one MCP tool per HTML form**, fill by field name, optionally submit.

Built on [Lightpanda](https://github.com/lightpanda-io/browser) (fast headless browser + `LP.detectForms`).

## What you get

| Tool | Purpose |
|------|---------|
| `web_attach` | Open a URL, detect forms, register dynamic `form_*` tools |
| `web_forms` | List schemas for compiled forms on the current page |
| `form_0_*`, … | Fill fields by name; submit only with `autoSubmit: true` or `confirmSubmit: true` |

This is a **polyfill** for sites that never added [WebMCP form attributes](https://developer.chrome.com/docs/ai/webmcp/declarative-api). It is not the browser-native WebMCP API.

## Requirements

- **Node.js 20+**
- **Lightpanda** on your `PATH` ([install](https://lightpanda.io/docs/run-locally/installation/))

## Quick start

```bash
git clone https://github.com/harikishantk/mint-webmcp.git
cd mint-webmcp
npm install
npm run doctor    # checks Node, build output, Lightpanda, port
npm run smoke     # attach + submit https://httpbin.org/forms/post
```

## Use with Cursor (or any MCP client)

1. Build once: `npm run build`
2. Add to **Cursor Settings → MCP** (merge into your config):

```json
{
  "mcpServers": {
    "mint-webmcp": {
      "command": "node",
      "args": ["/absolute/path/to/mint-webmcp/dist/server.js"],
      "env": {
        "LIGHTPANDA_PORT": "9222"
      }
    }
  }
}
```

See [examples/cursor-mcp.json](examples/cursor-mcp.json).

3. Reload MCP. In chat, ask the agent to:
   - call **`web_attach`** with `https://httpbin.org/forms/post`
   - call the returned **`form_0_post`** tool with `custname`, `custemail`, etc.

After `web_attach`, **new tools appear in the tool list** (MCP `listChanged`).

## How users work with a form

You use mint-webmcp through an MCP-enabled agent chat; it is not a browser extension or a UI you click yourself.

1. Tell the agent which page to inspect: “Attach `https://example.com/contact` with mint-webmcp.”
2. The agent calls `web_attach`. It receives the form-specific tool names, such as `form_0_contact` and `form_1_newsletter`.
3. Ask the agent to call the one you want. Each generated tool contains only that form's fields, even if multiple forms use the same field name.
4. Inspect the response. Fields are filled by default; pass `confirmSubmit: true` only after you intend to send the form.

Example prompt:

> Attach `https://httpbin.org/forms/post`. Show the form schema, fill it with Ada Lovelace and `ada@example.com`, then ask me for confirmation before submitting.

Example tool call after confirmation:

```json
{
  "custname": "Ada Lovelace",
  "custemail": "ada@example.com",
  "size": "medium",
  "topping": ["bacon", "cheese"],
  "confirmSubmit": true
}
```

Use `web_forms` when an agent needs the exact field names or to choose between several generated form tools.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `LIGHTPANDA_BIN` | `lightpanda` | Path or name of Lightpanda binary |
| `LIGHTPANDA_PORT` | `9222` | CDP port for `lightpanda serve` |

If port 9222 is busy, set `LIGHTPANDA_PORT` in MCP `env` and restart.

## Agent workflow

```
web_attach(url) → read formTools[] → form_0_*(fields, autoSubmit?) → JSON result (status, validationErrors, …)
```

- **`autoSubmit` defaults to `false`** — fill only unless you pass **`autoSubmit: true`** or **`confirmSubmit: true`** (WebMCP `toolautosubmit`)
- Responses include **`status`** (`filled`, `submitted`, `validation_error`, …) and **`validationErrors`** when the page shows invalid/required fields
- **`web_forms`** — inspect JSON Schema without calling a form

## Replay with PandaScript

After a successful **`form_*`** call, mint-webmcp remembers the field values you used (in memory only).

**`web_export_script`** builds a `.js` file you can rerun without MCP or an LLM:

```text
web_export_script {
  "toolName": "form_0_post",
  "path": "./scripts/replay-httpbin.js"
}
```

Then:

```bash
lightpanda run ./scripts/replay-httpbin.js
```

- Uses **last fill values** for that tool unless you call `form_*` again first.
- Before any fill, export produces empty `"" /* field */` placeholders.
- Use **`$LP_*`** placeholders in form values (e.g. `$LP_SITE_PASSWORD`) — they are preserved in the script and resolved by Lightpanda at runtime.

Form submit responses include a `replay` hint pointing at `web_export_script`.

## Agent skill

This repository ships a reusable project skill at [`.cursor/skills/mint-webmcp/SKILL.md`](.cursor/skills/mint-webmcp/SKILL.md).

- In this repository, Cursor discovers it automatically as a project skill.
- For another repository, copy the `mint-webmcp` directory into that repository's `.cursor/skills/` directory.
- For a personal Cursor skill, copy the directory into your personal Agent Store under `skills/mint-webmcp/`.

The skill teaches an agent the safe workflow: attach, inspect, fill, explicitly confirm submission, inspect validation results, then optionally export PandaScript.

## Limits (v0.1)

- Classic `<form>` elements only (via Lightpanda `detectForms`)
- Multi-step wizards, custom components, and captcha are out of scope
- Submit uses heuristics (`button[type=submit]`, etc.)

## Development

```bash
npm run dev          # tsx, no separate build step
npm run build
npm run doctor
npm run smoke
npm run test:replay   # export + lightpanda run replay
```

## License

MIT
