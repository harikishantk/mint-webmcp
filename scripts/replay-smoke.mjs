#!/usr/bin/env node
/**
 * Export PandaScript from a live attach+fill, then replay with `lightpanda run`.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LightpandaSession } from "../dist/browser-session.js";

const port = Number(process.env.LIGHTPANDA_PORT ?? 9222);
const bin = process.env.LIGHTPANDA_BIN ?? "lightpanda";

const session = new LightpandaSession(bin, port);
const tmp = await mkdtemp(join(tmpdir(), "mint-webmcp-replay-"));
const scriptPath = join(tmp, "replay.js");

try {
  const { tools } = await session.attach("https://httpbin.org/forms/post");
  const toolName = tools[0]?.toolName;
  if (!toolName) throw new Error("No form tool compiled");

  await session.invokeForm(toolName, {
    custname: "replay-test",
    custemail: "replay@example.com",
    autoSubmit: true,
  });

  const script = session.exportPandaScript(toolName, { autoSubmit: true });
  await writeFile(scriptPath, script, "utf8");
  await session.close();

  const run = spawnSync(bin, ["run", scriptPath], {
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 2 * 1024 * 1024,
  });

  const combined = `${run.stdout}\n${run.stderr}`;
  if (run.status !== 0) {
    throw new Error(`lightpanda run failed (${run.status}):\n${combined.slice(0, 1500)}`);
  }
  if (!combined.includes("replay@example.com") && !combined.includes("replay-test")) {
    throw new Error(`Replay output missing submitted fields:\n${combined.slice(0, 1500)}`);
  }

  console.log("replay ok");
} finally {
  await session.close().catch(() => undefined);
  await rm(tmp, { recursive: true, force: true });
}
