import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const RECIPIENTS_FILE = ".github/site-report-recipients.txt";
// A native age X25519 public key: "age1" plus 58 bech32 characters.
const AGE_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;

export function parseRecipients(text) {
  const recipients = [];
  const problems = [];
  String(text)
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      if (!AGE_RECIPIENT.test(line)) problems.push(`line ${index + 1} is not a native age public key (age1…)`);
      else if (recipients.includes(line)) problems.push(`line ${index + 1} repeats a key`);
      else recipients.push(line);
    });
  if (!recipients.length && !problems.length) problems.push("no public key is listed");
  return { recipients, problems };
}

export async function checkRecipientsFile(path = RECIPIENTS_FILE) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { recipients: [], problems: [`${path} does not exist`] };
  }
  return parseRecipients(text);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { recipients, problems } = await checkRecipientsFile(process.argv[2] ?? RECIPIENTS_FILE);
  if (problems.length) {
    console.error(`The site report has no usable encryption key: ${problems.join("; ")}.`);
    console.error("Run `npm run report:keygen` on your machine and commit .github/site-report-recipients.txt.");
    process.exitCode = 1;
  } else {
    console.log(`Encrypting to ${recipients.length} public key${recipients.length === 1 ? "" : "s"}.`);
  }
}
