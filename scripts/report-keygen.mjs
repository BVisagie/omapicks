// Creates the key that reads the private site report: an age key whose private half is
// stored only in a passphrase-protected file outside the repository. The public half is
// written to .github/site-report-recipients.txt for the workflow to encrypt to.
import { access, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalError, keyPath, main, requireTool, run } from "./report/local.mjs";
import { RECIPIENTS_FILE, parseRecipients } from "./report/recipients.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INSTALL_HINT = "Install it with `sudo pacman -S age` (or your distribution's age package).";

main(async () => {
  requireTool("age", INSTALL_HINT);
  requireTool("age-keygen", INSTALL_HINT);
  const file = keyPath();
  if (await access(file).then(() => true, () => false)) {
    throw new LocalError(`A report key already exists at ${file}. To make a new one, move that file aside first; reports encrypted to it stay readable only with it.`);
  }

  // The unprotected identity exists only in this process's memory and age's stdin.
  const identity = await run("age-keygen", [], { capture: true });
  const publicKey = identity.match(/^# public key: (age1[0-9a-z]+)$/m)?.[1];
  const { recipients, problems } = parseRecipients(publicKey ?? "");
  if (problems.length || recipients.length !== 1) throw new LocalError("age-keygen did not produce a recognizable public key.");

  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  console.log("Choose a passphrase for the report key. You will need it each time you open a report.");
  await run("age", ["--passphrase", "--armor", "--output", file], { input: identity });
  await chmod(file, 0o600);

  console.log("Checking the key: enter the same passphrase once more.");
  const probe = `omapicks report key check ${Date.now()}`;
  try {
    const sealed = await run("age", ["--encrypt", "--armor", "--recipient", publicKey], { input: probe, capture: true });
    const opened = await run("age", ["--decrypt", "--identity", file], { input: sealed, capture: true });
    if (opened !== probe) throw new LocalError("The key check decrypted the wrong text.");
  } catch (error) {
    await rm(file, { force: true });
    throw new LocalError(`The new key failed its check and was removed (${error.message}) Run the command again.`);
  }

  const recipientsFile = path.join(ROOT, RECIPIENTS_FILE);
  await writeFile(
    recipientsFile,
    `# Public age key that encrypts the private site report (created ${new Date().toISOString().slice(0, 10)}).\n# Its private half is a passphrase-protected file kept outside this repository.\n${publicKey}\n`
  );
  console.log(`\nKey saved to ${file}`);
  console.log(`Public key written to ${RECIPIENTS_FILE}`);
  console.log("\nNext:");
  console.log(`  1. Commit ${RECIPIENTS_FILE} to the default branch.`);
  console.log(`  2. Copy ${file} to a second place (a USB stick or cloud storage is fine; it is encrypted).`);
  console.log("  3. Store the passphrase in your password manager.");
});
