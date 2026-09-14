import { appendFile, copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function findStateFile(directory) {
  const matches = [];
  async function visit(current) {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name === "state.json") matches.push(file);
    }
  }
  await visit(directory);
  if (matches.length > 1) throw new Error("Downloaded discovery artifact contains multiple state.json files");
  return matches[0] ?? null;
}

export async function restoreState({ directory, destination, envFile }) {
  const source = await findStateFile(directory);
  if (!source) return false;
  // Export a fixed destination, never an artifact-supplied path into GITHUB_ENV.
  if (/[\r\n]/.test(destination)) throw new Error("Invalid restored state destination");
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await appendFile(envFile, `DISCOVERY_PREVIOUS=${destination}\n`);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  restoreState({
    directory: "tmp/category-discovery-previous",
    destination: "tmp/category-discovery-restored/state.json",
    envFile: process.env.GITHUB_ENV
  }).then((restored) => console.log(restored
    ? "Restored discovery state from the downloaded artifact."
    : "Downloaded artifact did not contain state.json; starting a baseline."
  )).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
