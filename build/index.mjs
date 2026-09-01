import path from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "./render.mjs";

async function main() {
  const result = await render();
  console.log(`Rendered ${result.typeCount} app types and ${result.historyCount} weekly snapshots to dist/.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
