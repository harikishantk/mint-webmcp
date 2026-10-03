#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { LightpandaSession } from "./browser-session.js";
const LIGHTPANDA_BIN = process.env.LIGHTPANDA_BIN ?? "lightpanda";
const LIGHTPANDA_PORT = Number(process.env.LIGHTPANDA_PORT ?? "9222");
const session = new LightpandaSession(LIGHTPANDA_BIN, LIGHTPANDA_PORT);
const server = new McpServer({
    name: "mint-webmcp",
    version: "0.1.0",
});
const dynamicFormTools = [];
function zodForField(field) {
    if (field.kind === "enum") {
        if (field.values.length >= 1) {
            return z.enum(field.values).optional();
        }
        return z.string().optional();
    }
    if (field.kind === "checkboxes") {
        return z.array(z.string()).optional();
    }
    return z.string().optional();
}
function clearFormTools() {
    for (const tool of dynamicFormTools) {
        tool.remove();
    }
    dynamicFormTools.length = 0;
}
function registerFormTools(tools) {
    clearFormTools();
    for (const ft of tools) {
        const shape = {
            autoSubmit: z
                .boolean()
                .optional()
                .describe("Submit after filling (WebMCP toolautosubmit). Default true."),
        };
        for (const field of ft.fields) {
            shape[field.name] = zodForField(field);
        }
        const registered = server.registerTool(ft.toolName, {
            description: ft.description,
            inputSchema: shape,
        }, async (args) => {
            const text = await session.invokeForm(ft.toolName, args);
            return { content: [{ type: "text", text }] };
        });
        dynamicFormTools.push(registered);
    }
}
server.tool("web_attach", "Load a URL in Lightpanda and compile each HTML form into a dedicated MCP tool (WebMCP-style). Returns tool names to call next.", {
    url: z.string().url().describe("Page URL to attach"),
    timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Navigation timeout in ms (default 30000)"),
}, async ({ url, timeoutMs }) => {
    const result = await session.attach(url, timeoutMs ?? 30_000);
    registerFormTools(result.tools);
    const toolList = result.tools.map((t) => ({
        name: t.toolName,
        description: t.description,
    }));
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    url: result.url,
                    title: result.title,
                    formTools: toolList,
                    hint: "New MCP tools were registered for each form. Call them by name with field values.",
                }, null, 2),
            },
        ],
    };
});
server.tool("web_forms", "List form tools compiled from the current attached page.", {}, async () => {
    const tools = session.getFormTools();
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    pageUrl: session.getPageUrl(),
                    formTools: tools.map((t) => ({
                        name: t.toolName,
                        description: t.description,
                        schema: t.inputSchema,
                    })),
                }, null, 2),
            },
        ],
    };
});
async function main() {
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
