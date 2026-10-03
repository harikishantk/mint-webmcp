#!/usr/bin/env node
/**
 * End-to-end smoke: attach httpbin form page and submit once.
 */
import { LightpandaSession } from "../dist/browser-session.js";

const port = Number(process.env.LIGHTPANDA_PORT ?? 9222);
const bin = process.env.LIGHTPANDA_BIN ?? "lightpanda";

const session = new LightpandaSession(bin, port);

try {
  const { tools, title } = await session.attach("https://httpbin.org/forms/post");
  if (tools.length === 0) {
    throw new Error("Expected at least one compiled form tool");
  }
  console.log("attach ok:", title, "→", tools[0].toolName);

  const out = JSON.parse(
    await session.invokeForm(tools[0].toolName, {
      custname: "mint-webmcp smoke",
      custemail: "smoke@example.com",
      autoSubmit: true,
    }),
  );

  if (out.status !== "submitted" || !String(out.url).includes("/post")) {
    throw new Error(`Unexpected result: ${JSON.stringify(out).slice(0, 200)}`);
  }
  if (!out.markdown?.includes("custname")) {
    throw new Error("Response markdown missing submitted fields");
  }

  console.log("submit ok:", out.url);
  console.log("smoke passed");
} finally {
  await session.close();
}
