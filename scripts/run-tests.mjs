import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2).flatMap((arg) =>
  arg === "--runInBand" ? ["--maxWorkers=1", "--no-file-parallelism"] : [arg]
);
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run", ...args],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
