import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("node", ["scripts/verify-gate.mjs"]);
run("npx", ["vitest", "run"]);
run("npm", ["run", "verify:copy"]);
console.log("CHECK=PASS");
