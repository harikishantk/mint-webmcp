#!/usr/bin/env node
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";

const lightpandaBin = process.env.LIGHTPANDA_BIN ?? "lightpanda";
const port = Number(process.env.LIGHTPANDA_PORT ?? 9222);

let ok = true;

function pass(msg) {
  console.log(`✓ ${msg}`);
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  ok = false;
}

if (Number(process.version.slice(1).split(".")[0]) < 20) {
  fail(`Node ${process.version} — need Node 20+`);
} else {
  pass(`Node ${process.version}`);
}

try {
  await access("dist/server.js", constants.R_OK);
  pass("dist/server.js (run npm run build if missing)");
} catch {
  fail("dist/server.js missing — run: npm run build");
}

const which = spawnSync("sh", ["-c", `command -v ${JSON.stringify(lightpandaBin)}`], {
  encoding: "utf8",
});
if (which.status !== 0) {
  fail(
    `Lightpanda not on PATH (${lightpandaBin}). Install: https://lightpanda.io/docs/run-locally/installation/`,
  );
} else {
  const ver = spawnSync(lightpandaBin, ["version"], { encoding: "utf8" });
  pass(`Lightpanda: ${(ver.stdout || ver.stderr || "").trim() || lightpandaBin}`);
}

try {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (res.ok) {
    console.warn(
      `⚠ Port ${port} already has a CDP server — set LIGHTPANDA_PORT if mint-webmcp fails to start Lightpanda`,
    );
  } else {
    pass(`Port ${port} is free for Lightpanda`);
  }
} catch {
  pass(`Port ${port} is free for Lightpanda`);
}

process.exit(ok ? 0 : 1);
