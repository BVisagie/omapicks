import assert from "node:assert/strict";
import test from "node:test";
import { publicationHistory, historyPublications, publicationReference } from "../build/publication-history.mjs";

const publication = (methodologyVersion, generatedAt, extra = {}) => ({ week: "2026-W44", methodologyVersion, generatedAt, ...extra });

test("same-week methodology migrations preserve the complete preceding publication without relabeling it", () => {
  const old = publication("1.3.0", "2026-10-29T19:35:18.101Z", { types: [{ id: "lock-idle", taskContract: { version: 1 } }],
    changes: [{ typeId: "shortcut-guides", current: { id: "promoter" } }], runnerUpChanges: [{ typeId: "containers", previous: { id: "control" }, current: { id: "docker" } }] });
  const current = publication("1.4.0", "2026-10-30T12:00:00.000Z");
  const migrated = publicationHistory(old, current, old);
  assert.deepEqual(migrated.publicationBaseline, publicationReference(old));
  assert.deepEqual(migrated.supersededPublications, [old]);
  const saved = { ...current, ...migrated };
  const repeated = publicationHistory(saved, { ...current, generatedAt: "2026-10-30T13:00:00.000Z" }, saved);
  assert.deepEqual(repeated, migrated);
  assert.equal(historyPublications([saved]).length, 2);
  assert.equal(historyPublications([saved])[0].superseded, true);
  assert.deepEqual(historyPublications([saved])[0].changes, old.changes);
  const nextWeek = { ...current, week: "2026-W45" };
  assert.deepEqual(publicationHistory(saved, nextWeek, null).supersededPublications, []);
  assert.deepEqual(publicationHistory(saved, nextWeek, null).publicationBaseline, publicationReference(saved));
  const earlier = publication("1.2.0", "2026-10-28T10:00:00.000Z", { types: [], changes: [] });
  const multiple = publicationHistory(old, current, { ...old, supersededPublications: [earlier] });
  assert.deepEqual(multiple.supersededPublications, [earlier, old]);
  assert.ok(multiple.supersededPublications.every((snapshot) => !snapshot.supersededPublications));
});
