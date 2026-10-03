#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { LightpandaSession } from "./browser-session.js";
import type { CompiledFormTool } from "./types.js";
import { assertLightpandaAvailable } from "./preflight.js";

const LIGHTPANDA_BIN = process.env.LIGHTPANDA_BIN ?? "lightpanda";
const LIGHTPANDA_PORT = Number(process.env.LIGHTPANDA_PORT ?? "9222");

const session = new LightpandaSession(LIGHTPANDA_BIN, LIGHTPANDA_PORT);

const server = new McpServer({
  name: "mint-webmcp",
  version: "0.1.0",
});

type RegisteredTool = ReturnType<McpServer["registerTool"]>;
const dynamicFormTools: RegisteredTool[] = [];

function zodForField(field: CompiledFormTool["fields"][number]): z.ZodTypeAny {
  if (field.kind === "boolean") {
    return z.boolean().optional();
  }
  if (field.kind === "enum") {
    if (field.values.length >= 1) {
      return z.enum(field.values as [string, ...string[]]).optional();
    }
    return z.string().optional();
  }
  if (field.kind === "checkboxes") {
    return z.array(z.string()).optional();
  }
  return z.string().optional();
}

function clearFormTools(): void {
  for (const tool of dynamicFormTools) {
    tool.remove();
  }
  dynamicFormTools.length = 0;
}

function registerFormTools(tools: CompiledFormTool[]): void {
  clearFormTools();
  for (const ft of tools) {
    const shape: Record<string, z.ZodTypeAny> = {
      autoSubmit: z
        .boolean()
        .optional()
        .describe(
          "Submit after filling (WebMCP toolautosubmit). Default false — pass true or confirmSubmit: true to submit.",
        ),
      confirmSubmit: z
        .boolean()
        .optional()
        .describe("Alias for autoSubmit: true — explicit confirmation to submit after fill."),
    };
    for (const field of ft.fields) {
      shape[field.name] = zodForField(field);
    }

    const registered = server.registerTool(
      ft.toolName,
      {
        description: ft.description,
        inputSchema: shape,
      },
      async (args) => {
        const text = await session.invokeForm(ft.toolName, args as Record<string, unknown>);
        return { content: [{ type: "text" as const, text }] };
      },
    );
    dynamicFormTools.push(registered);
  }
}

server.tool(
  "web_attach",
  "Load a URL in Lightpanda and compile each HTML form into a dedicated MCP tool (WebMCP-style). Returns tool names to call next.",
  {
    url: z.string().url().describe("Page URL to attach"),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Navigation timeout in ms (default 30000)"),
  },
  async ({ url, timeoutMs }) => {
    const result = await session.attach(url, timeoutMs ?? 30_000);
    registerFormTools(result.tools);
    const toolList = result.tools.map((t) => ({
      name: t.toolName,
      description: t.description,
    }));
    const payload: Record<string, unknown> = {
      url: result.url,
      title: result.title,
      formTools: toolList,
    };
    if (toolList.length === 0) {
      payload.hint =
        "No classic HTML <form> elements were detected. SPAs, div-based UIs, and login walls may need generic browser MCP instead.";
    } else {
      payload.hint =
        "New MCP tools were registered for each form. Call them by name with field values (autoSubmit defaults to false; pass autoSubmit: true or confirmSubmit: true to submit). Then web_export_script to save a PandaScript replay.";
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "web_forms",
  "List form tools compiled from the current attached page.",
  {},
  async () => {
    const tools = session.getFormTools();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              pageUrl: session.getPageUrl(),
              formTools: tools.map((t) => ({
                name: t.toolName,
                description: t.description,
                schema: t.inputSchema,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "web_export_script",
  "Generate a replayable PandaScript (.js) for a compiled form tool. Uses field values from the last form_* call unless values are passed. Optionally write to disk.",
  {
    toolName: z.string().describe("Compiled form tool name, e.g. form_0_post"),
    path: z
      .string()
      .optional()
      .describe("If set, write the script to this file path (absolute or relative to cwd)"),
    autoSubmit: z
      .boolean()
      .optional()
      .describe("Include submit + wait (default: same as last invoke, else false)"),
  },
  async ({ toolName, path, autoSubmit }) => {
    const script = session.exportPandaScript(toolName, { autoSubmit });
    let written: string | undefined;
    if (path) {
      const out = resolve(path);
      await writeFile(out, script, "utf8");
      written = out;
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              toolName,
              written,
              run: written ? `lightpanda run ${written}` : "lightpanda run script.js",
              script,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

async function main(): Promise<void> {
  try {
    assertLightpandaAvailable(LIGHTPANDA_BIN);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    console.error("Run: npm run doctor");
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("SIGINT", async () => {
    await session.close();
    process.exit(0);
  });
}

main().catch(async (err) => {
  console.error(err);
  await session.close();
  process.exit(1);
});
