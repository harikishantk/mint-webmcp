---
name: mint-webmcp
description: Use mint-webmcp to turn ordinary HTML forms into form-specific MCP tools, fill them safely, inspect validation results, and export repeatable PandaScripts. Use when a user asks to fill, submit, inspect, automate, or replay a webpage form through mint-webmcp.
disable-model-invocation: true
---

# mint-webmcp

Use this skill when the `mint-webmcp` MCP server is configured and a user wants to interact with a standard HTML form.

## Safe workflow

1. Call `web_attach` with the page URL.
2. Read the returned `formTools`. Each one maps to one detected `<form>`.
3. If field names or tool selection are unclear, call `web_forms`.
4. Call the selected `form_*` tool with values.
5. Do **not** submit by default. A form tool fills only unless `autoSubmit: true` or `confirmSubmit: true` is supplied.
6. Read `status` and `validationErrors` before reporting completion.

## Selecting a form

- Use the generated tool whose description/schema fits the user's intent.
- `form_0_*` is the first form in DOM order, `form_1_*` is the second, and so on.
- A new `web_attach` replaces the current form tools. Attach the URL containing the form to use.

## Submission policy

- For consequential actions—login, contact messages, payments, account updates, deletes—fill first and ask for explicit confirmation.
- Only pass `confirmSubmit: true` after the user has confirmed the exact action and values.
- A `submitted` result means the browser completed the form flow; it does not prove that a business-side transaction succeeded. Inspect the returned page content.

## Validation

`validation_error` can include native required-field errors, `aria-invalid`, alerts, and common error classes. Explain the field/message to the user and correct only values they provide or authorize.

## PandaScript replay

After a successful or filled `form_*` call, use:

```text
web_export_script { "toolName": "form_0_example", "path": "./replay.js", "autoSubmit": true }
```

Replay it with:

```bash
lightpanda run ./replay.js
```

Use `$LP_*` placeholders for secrets, for example `$LP_SITE_PASSWORD`. Never write real credentials into a committed script.

## Boundaries

- mint-webmcp supports forms detected as standard HTML `<form>` elements.
- Do not promise support for captchas, MFA, cross-origin iframes, custom div-based controls, or multi-step SPA flows.
- If `web_attach` returns no forms, explain that this page needs a generic browser tool or a different integration.
