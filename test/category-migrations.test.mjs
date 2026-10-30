import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORY_MIGRATIONS, categoryChangesBetween, migrationsForSnapshot, taskDefinitionChanged } from "../build/category-migrations.mjs";
import { changesBetween, runnerUpChangesBetween } from "../build/rank.mjs";
import { methodologyFor } from "../build/methodology.mjs";

const contract = (version, outcome = "Read and control the relevant task") => ({ version, outcome, capabilitySets: [["complete-task"]] });
const type = (id, version = 1, winner = "a", runnerUp = "b") => ({ id, name: id,
  taskContract: contract(version), winner: winner && { id: winner, name: winner }, runnerUp: runnerUp && { id: runnerUp, name: runnerUp } });
const snapshot = (version, types) => ({ methodologyVersion: version, types });

test("published methods retain their rules and only the new method declares task coherence", () => {
  assert.equal(methodologyFor("1.3.0").eligibility.taskCoherence, undefined);
  assert.equal(methodologyFor("1.4.0").eligibility.taskCoherence, true);
  for (const field of ["weights", "normalization", "freshness", "verification", "installRate"]) {
    assert.deepEqual(methodologyFor("1.4.0")[field], methodologyFor("1.3.0")[field]);
  }
  assert.equal(migrationsForSnapshot(snapshot("1.3.0", [])).length, 0);
  assert.equal(migrationsForSnapshot(snapshot("1.4.0", [])).length, 1);
  assert.throws(() => migrationsForSnapshot(snapshot("unknown", [])), /Unknown methodology/);
  assert.ok(Object.isFrozen(CATEGORY_MIGRATIONS[0].changes[0].to));
});

test("a one-to-many retirement is recorded once and only when all successors exist", () => {
  const before = snapshot("1.3.0", [type("lock-idle")]);
  const after = snapshot("1.4.0", [type("lock-screen", 2), type("idle-sleep", 2), type("keep-awake", 2)]);
  const [entry] = categoryChangesBetween(before, after);
  assert.equal(entry.from.id, "lock-idle");
  assert.equal(entry.kind, "split");
  assert.equal(entry.retired, true);
  assert.deepEqual(entry.to.map((t) => t.id), ["lock-screen", "idle-sleep", "keep-awake"]);
  assert.deepEqual(categoryChangesBetween(after, after), []);
  assert.deepEqual(categoryChangesBetween(null, after), []);
  assert.deepEqual(categoryChangesBetween(before, { ...after, types: after.types.slice(0, 2) }), []);
  assert.deepEqual(categoryChangesBetween(before, { ...after, types: [...after.types, type("lock-idle")] }), []);
});

test("a retained route can split, while other changed contracts get explicit redefinition events", () => {
  const before = snapshot("1.3.0", [type("weather"), type("notes")]);
  const after = snapshot("1.4.0", [type("weather", 2), type("weather-radar", 2), type("notes", 2)]);
  const changes = categoryChangesBetween(before, after);
  assert.equal(changes.length, 2);
  assert.equal(changes[0].from.id, "weather");
  assert.equal(changes[0].retired, false);
  assert.equal(changes[1].kind, "narrowed");
  assert.match(changes[1].reason, /previous definition/);
  assert.deepEqual(categoryChangesBetween(before, { ...after, methodologyVersion: "1.3.0" }), []);
});

test("different task requirements are distinguished from popularity displacement in both slots", () => {
  const before = snapshot("1.3.0", [type("notes")]);
  const after = snapshot("1.4.0", [type("notes", 2, "c", "d")]);
  assert.equal(changesBetween(before, after)[0].reason, "task-definition-changed");
  assert.equal(runnerUpChangesBetween(before, after)[0].reason, "task-definition-changed");
  const sameTask = snapshot("1.4.0", [type("notes", 1, "c", "d")]);
  assert.equal(changesBetween(before, sameTask)[0].reason, undefined);
  // Global availability evidence remains independently meaningful during a migration.
  const context = { catalogIds: new Set(["a", "b", "c", "d"]), exclusions: new Map([["a", "repository-unreachable"]]) };
  assert.equal(changesBetween(before, after, context)[0].reason, "repository-unreachable");
});

test("wording clarifications do not imply requalification or explain a popularity change", () => {
  const before = snapshot("1.3.0", [type("notes")]);
  const after = snapshot("1.4.0", [type("notes", 1, "c", "d")]);
  after.types[0].taskContract.outcome = "A clearer description of the same task";
  assert.equal(taskDefinitionChanged(before.types[0], after.types[0]), false);
  const [event] = categoryChangesBetween(before, after);
  assert.equal(event.kind, "clarified");
  assert.match(event.reason, /Qualification requirements and existing reviews are unchanged/);
  assert.doesNotMatch(event.reason, /previous definition/);
  assert.equal(changesBetween(before, after)[0].reason, undefined);
  assert.equal(runnerUpChangesBetween(before, after)[0].reason, undefined);
  after.types[0].taskContract.capabilitySets = [["different-task"]];
  assert.equal(taskDefinitionChanged(before.types[0], after.types[0]), true);
  assert.equal(categoryChangesBetween(before, after)[0].kind, "narrowed");
  const reordered = (sets) => ({ taskContract: { version: 1, capabilitySets: sets } });
  assert.equal(taskDefinitionChanged(reordered([["a", "b"], ["c"]]), reordered([["c"], ["b", "a"]])), false);
});
