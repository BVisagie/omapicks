import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyPlugin, prepareTaxonomy } from "../build/rank.mjs";

async function productionTaxonomy() {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  return prepareTaxonomy(source);
}

test("launcher classification requires an application-oriented Omarchy launcher", async () => {
  const prepared = await productionTaxonomy();

  assert.ok(
    !classifyPlugin(
      {
        id: "document-launcher",
        name: "Document Launcher",
        description: "An Omarchy launcher for documents, media, markdown notes, and code."
      },
      prepared
    ).includes("launcher")
  );

  assert.ok(
    classifyPlugin(
      {
        id: "app-launcher",
        name: "App Launcher",
        description: "An Omarchy launcher with fuzzy application search and command shortcuts."
      },
      prepared
    ).includes("launcher")
  );
});

test("theme support alone does not make a plugin a theme manager", async () => {
  const prepared = await productionTaxonomy();

  assert.ok(
    !classifyPlugin(
      {
        id: "themed-widget",
        name: "Themed Widget",
        description: "A status widget with built-in support for light and dark themes."
      },
      prepared
    ).includes("themes-appearance")
  );
});
