import { createHash } from "node:crypto";

export const TASK_REVIEW_SCHEMA_VERSION = 1;
export const taskMetadataHash = (plugin) => createHash("sha256")
  .update(JSON.stringify({ name: plugin.name ?? "", description: plugin.description ?? "", repo: plugin.repo ?? "" }))
  .digest("hex");
export const taskReviewsHash = (reviews) => createHash("sha256").update(JSON.stringify(reviews)).digest("hex");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Reviews are data, not executable rules. Their content and contracts travel with captured inputs.
export function prepareTaskReviews(reviews, types) {
  assert(reviews?.schemaVersion === TASK_REVIEW_SCHEMA_VERSION && Array.isArray(reviews.assignments), "Unsupported task review schema");
  const byType = new Map(types.map((type) => [type.id, type]));
  const result = new Map();
  for (const review of reviews.assignments) {
    const label = `${review.pluginId}/${review.typeId}`;
    const type = byType.get(review.typeId);
    assert(typeof review.pluginId === "string" && review.pluginId.length && type, `Unknown task review assignment: ${label}`);
    assert(["qualified", "related", "rejected"].includes(review.decision), `Invalid task review decision: ${label}`);
    assert(["core", "substantial-secondary", "integration"].includes(review.role), `Invalid task review role: ${label}`);
    assert(Number.isInteger(review.contractVersion) && review.contractVersion > 0, `Missing task contract version: ${label}`);
    assert(/^[a-f0-9]{64}$/.test(review.metadataHash), `Missing task metadata hash: ${label}`);
    assert(Array.isArray(review.capabilities) && review.capabilities.every((c) => typeof c === "string" && /^[a-z0-9-]+$/.test(c)), `Invalid capabilities: ${label}`);
    assert(Array.isArray(review.constraints) && review.constraints.every((c) => typeof c === "string" && c.trim()), `Invalid constraints: ${label}`);
    assert(typeof review.reason === "string" && review.reason.trim().length >= 20, `Missing task rationale: ${label}`);
    assert(typeof review.reviewedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt) && Number.isFinite(Date.parse(review.reviewedAt)) && new Date(review.reviewedAt).toISOString().slice(0, 10) === review.reviewedAt, `Missing task review date: ${label}`);
    assert(["catalog-evidence", "repository-evidence"].includes(review.provenance), `Missing task review provenance: ${label}`);
    let url;
    try { url = new URL(review.source?.url); } catch { /* reported below */ }
    assert(url?.protocol === "https:" && !url.username && !url.password && typeof review.source?.revision === "string" && review.source.revision.trim() && typeof review.source?.evidence === "string" && review.source.evidence.trim(), `Missing revision-bound source evidence: ${label}`);
    assert(!result.has(label), `Duplicate task review: ${label}`);
    if (review.decision === "qualified" && review.contractVersion === type.contract?.version) {
      assert(review.role !== "integration" && meetsContract(review, type), `Qualified review does not meet task contract: ${label}`);
    }
    result.set(label, review);
  }
  return result;
}

function meetsContract(review, type) {
  return type.contract?.capabilitySets?.some((set) => set.every((capability) => review.capabilities.includes(capability))) === true;
}

export function explainTaskFit(plugin, type, reviews) {
  const review = reviews.get(`${plugin.id}/${type.id}`);
  const base = { status: "pending", qualified: false, role: null, capabilities: [], constraints: [], reason: "Task capability evidence has not been reviewed for this assignment.", source: null, reviewedAt: null, provenance: null };
  if (!review) return base;
  if (review.contractVersion !== type.contract?.version) return { ...base, status: "stale-contract", reason: "The task definition changed after this capability review." };
  if (review.metadataHash !== taskMetadataHash(plugin)) return { ...base, status: "stale-metadata", reason: "The plugin's name, description or repository changed after this capability review." };
  const qualified = review.decision === "qualified" && review.role !== "integration" && meetsContract(review, type);
  return { status: qualified ? "qualified" : review.decision, qualified, metadataHash: review.metadataHash, contractVersion: review.contractVersion, role: review.role, capabilities: review.capabilities,
    constraints: review.constraints, reason: review.reason, source: review.source, reviewedAt: review.reviewedAt, provenance: review.provenance };
}

export function assertTaskQualifiedSnapshot(snapshot) {
  for (const type of snapshot.types) {
    validateTaskContracts([{ id: type.id, contract: type.taskContract }]);
    for (const candidate of [type.winner, type.runnerUp, ...(type.alternatives ?? [])].filter(Boolean)) {
      const fit = candidate.taskFit;
      assert(fit?.qualified && fit.status === "qualified" && ["core", "substantial-secondary"].includes(fit.role), `Unqualified recommendation: ${type.id}/${candidate.id}`);
      assert(fit.contractVersion === type.taskContract.version && meetsContract(fit, { contract: type.taskContract }), `Recommendation does not meet contract: ${type.id}/${candidate.id}`);
      assert(fit.metadataHash === taskMetadataHash({ name: candidate.name, description: candidate.description, repo: candidate.repository }), `Recommendation metadata changed: ${type.id}/${candidate.id}`);
      prepareTaskReviews({ schemaVersion: TASK_REVIEW_SCHEMA_VERSION, assignments: [{ ...fit, pluginId: candidate.id, typeId: type.id, decision: "qualified" }] }, [{ ...type, contract: type.taskContract }]);
    }
    assert(!type.winner || type.topScorer?.id === type.winner.id, `Task-qualified champion must be the current score leader: ${type.id}`);
  }
}

export function validateTaskContracts(types) {
  for (const type of types) {
    const contract = type.contract;
    assert(Number.isInteger(contract?.version) && contract.version > 0 && typeof contract.outcome === "string" && contract.outcome.trim().length > 10,
      `Missing task contract: ${type.id}`);
    assert(Array.isArray(contract.capabilitySets) && contract.capabilitySets.length && contract.capabilitySets.every((set) =>
      Array.isArray(set) && set.length && set.every((capability) => typeof capability === "string" && /^[a-z0-9-]+$/.test(capability))), `Invalid task capabilities: ${type.id}`);
  }
}

export function updateTaskReviewQueue(assignments, previous = null, generatedAt = new Date().toISOString()) {
  const prior = new Map((previous?.assignments ?? []).map((p) => [`${p.pluginId}/${p.typeId}`, p]));
  const current = assignments.map((p) => {
    const old = prior.get(`${p.pluginId}/${p.typeId}`);
    const sameEvidence = old?.metadataHash === p.metadataHash && old?.contractVersion === p.contractVersion;
    return { pluginId: p.pluginId, typeId: p.typeId, name: p.name, repository: p.repository, status: p.status,
      reason: p.reason, metadataHash: p.metadataHash, contractVersion: p.contractVersion,
      prospectiveScore: p.prospectiveScore, previousPick: p.previousPick, wouldEnterPodium: p.wouldEnterPodium,
      firstSeenAt: sameEvidence ? old.firstSeenAt : generatedAt, lastSeenAt: generatedAt };
  });
  const keys = new Set(current.map((p) => `${p.pluginId}/${p.typeId}`));
  return { schemaVersion: 1, generatedAt, resolvedCount: [...prior.keys()].filter((key) => !keys.has(key)).length, assignments: current };
}
