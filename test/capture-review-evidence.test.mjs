import assert from "node:assert/strict";
import test from "node:test";
import { fetchText } from "../scripts/capture-review-evidence.mjs";

const document = {
  url: `https://github.com/owner/plugin/blob/${"a".repeat(40)}/README.md`,
  revision: "a".repeat(40),
  path: "README.md",
};
const fakeFetch = (rawStatus, repositoryStatus) => async (url) =>
  url.startsWith("https://api.github.com/") ? new Response("{}", { status: repositoryStatus }) : new Response("text", { status: rawStatus });

test("a source in a deleted repository is unavailable, not a verification error", async () => {
  await assert.rejects(fetchText(document, fakeFetch(404, 404)), (error) => error.unavailable === true);
});

test("a missing file or commit in a repository that still exists stays an error", async () => {
  await assert.rejects(fetchText(document, fakeFetch(404, 200)), (error) => !error.unavailable && /Source fetch failed \(404\)/.test(error.message));
  await assert.rejects(fetchText(document, fakeFetch(404, 403)), (error) => !error.unavailable);
  await assert.rejects(fetchText(document, fakeFetch(500, 404)), (error) => !error.unavailable && /\(500\)/.test(error.message));
});

test("an available source is returned unchanged", async () => {
  assert.equal((await fetchText(document, fakeFetch(200, 200))).toString("utf8"), "text");
});
