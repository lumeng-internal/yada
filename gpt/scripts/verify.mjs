import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("node", ["scripts/verify-gate.mjs"]);
run("npm", ["run", "verify:unit"]);
run("npm", ["run", "verify:copy"]);
run("npm", ["run", "verify:features"]);
console.log("VERIFY=PASS");
