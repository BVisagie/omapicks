import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export const DEFAULT_KEY = path.join(os.homedir(), ".config", "omapicks", "site-report-key.age");
export const DEFAULT_ARCHIVE = path.join(os.homedir(), "Documents", "omapicks-reports");

export function keyPath(env = process.env) {
  return env.OMAPICKS_REPORT_KEY || DEFAULT_KEY;
}

export function archiveDir(env = process.env) {
  return env.OMAPICKS_REPORT_ARCHIVE || DEFAULT_ARCHIVE;
}

export class LocalError extends Error {}

export function requireTool(name, hint) {
  const result = spawnSync(name, ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new LocalError(`${name} is not installed. ${hint}`);
}

// Runs a tool with the terminal attached so age can ask for a passphrase on /dev/tty. Only
// stdin and stdout are redirected when the caller supplies input or wants output.
export function run(command, args, { input, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? "inherit" : "pipe", capture ? "pipe" : "inherit", "inherit"] });
    const chunks = [];
    if (capture) child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(new LocalError(`${command} exited with status ${code}.`))));
    if (input !== undefined) child.stdin.end(input);
  });
}

export function main(task) {
  task().catch((error) => {
    console.error(error instanceof LocalError ? error.message : (error?.stack ?? String(error)));
    process.exitCode = 1;
  });
}
