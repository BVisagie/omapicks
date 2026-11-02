// Downloads the latest encrypted site report, keeps the encrypted copy in an archive folder,
// decrypts it into memory-backed runtime storage and opens it in the browser.
//   npm run report:open                       latest completed run
//   npm run report:open -- --run 12345678     a specific run
//   npm run report:open -- --file <path>      an archived .tar.age file
//   add --no-open to print the path instead of opening a browser
import { access, chmod, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { LocalError, archiveDir, keyPath, main, requireTool, run } from "./report/local.mjs";

const ARTIFACT = "site-report-encrypted";
const WORKFLOW = "site-report.yml";

function parse(argv) {
  const options = { run: null, file: null, open: true };
  const args = [...argv];
  while (args.length) {
    const flag = args.shift();
    if (flag === "--run") options.run = args.shift();
    else if (flag === "--file") options.file = path.resolve(args.shift() ?? "");
    else if (flag === "--no-open") options.open = false;
    else throw new LocalError(`Unknown option ${flag}.`);
  }
  if (options.run !== null && !/^\d{1,20}$/.test(options.run)) throw new LocalError("--run takes a numeric workflow run ID.");
  return options;
}

async function candidateRuns(requested) {
  if (requested) return [{ databaseId: requested, createdAt: new Date().toISOString() }];
  const listed = JSON.parse(await run("gh", ["run", "list", "--workflow", WORKFLOW, "--limit", "10", "--json", "databaseId,status,createdAt"], { capture: true }));
  return listed.filter((entry) => entry.status === "completed").map((entry) => ({ databaseId: String(entry.databaseId), createdAt: entry.createdAt }));
}

async function download(archive, requested) {
  await mkdir(archive, { recursive: true, mode: 0o700 });
  for (const candidate of (await candidateRuns(requested)).slice(0, 5)) {
    const staging = await mkdtemp(path.join(archive, ".download-"));
    try {
      await run("gh", ["run", "download", candidate.databaseId, "--name", ARTIFACT, "--dir", staging], { capture: true });
      const name = `omapicks-site-report-${String(candidate.createdAt).slice(0, 10)}-run${candidate.databaseId}.tar.age`;
      const target = path.join(archive, name);
      await rename(path.join(staging, "site-report.tar.age"), target);
      return target;
    } catch {
      // That run has no report (it failed early or its artifact expired); try the previous one.
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  throw new LocalError("No recent Site report run has an encrypted report to download. Start one under Actions → Site report.");
}

main(async () => {
  const options = parse(process.argv.slice(2));
  requireTool("age", "Install it with `sudo pacman -S age`.");
  const key = keyPath();
  if (!(await access(key).then(() => true, () => false))) {
    throw new LocalError(`No report key at ${key}. Restore your backup copy there, or set OMAPICKS_REPORT_KEY to its path.`);
  }
  let encrypted = options.file;
  if (!encrypted) {
    requireTool("gh", "Install the GitHub CLI and run `gh auth login`.");
    encrypted = await download(archiveDir(), options.run);
    console.log(`Encrypted copy archived at ${encrypted}`);
  }

  const runtime = process.env.XDG_RUNTIME_DIR;
  if (!runtime) console.warn("XDG_RUNTIME_DIR is not set, so the decrypted copy goes to the system temp folder instead of memory.");
  const target = await mkdtemp(path.join(runtime || os.tmpdir(), "omapicks-report-"));
  await chmod(target, 0o700);
  const tarball = path.join(target, "report.tar");
  console.log("Enter the report key passphrase.");
  await run("age", ["--decrypt", "--identity", key, "--output", tarball, encrypted]);
  await run("tar", ["--extract", "--no-same-owner", "--file", tarball, "--directory", target, "report.html", "report.json"]);
  await rm(tarball);
  const unexpected = (await readdir(target)).filter((name) => !["report.html", "report.json"].includes(name));
  if (unexpected.length) throw new LocalError("The decrypted report contained unexpected files.");

  const html = path.join(target, "report.html");
  console.log(`Decrypted report: ${html}${runtime ? " (in memory; it disappears when you log out)" : ""}`);
  if (options.open) spawn("xdg-open", [html], { detached: true, stdio: "ignore" }).on("error", () => console.log("Open the file above in your browser.")).unref();
});
