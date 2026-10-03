import { spawnSync } from "node:child_process";

export function assertLightpandaAvailable(lightpandaBin: string): void {
  const which = spawnSync("sh", ["-c", `command -v ${JSON.stringify(lightpandaBin)}`], {
    encoding: "utf8",
  });
  if (which.status !== 0) {
    throw new Error(
      `Lightpanda binary "${lightpandaBin}" not found on PATH. ` +
        "Install: https://lightpanda.io/docs/run-locally/installation/ " +
        "or set LIGHTPANDA_BIN to the full path.",
    );
  }
}
