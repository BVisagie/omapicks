// Every published snapshot names the methodology that produced it, and pages rendered from that
// snapshot must keep describing those rules even after newer scoring code merges. A definition is
// therefore immutable once any snapshot uses it: add a new version instead of editing an old one.

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Snapshots written before methodology versions were recorded used these rules.
export const LEGACY_METHODOLOGY_VERSION = "1.0.0";

const DEFINITIONS = [
  {
    version: "1.0.0",
    // Incumbent selection: a challenger must score strictly more than 10% above an available incumbent.
    hysteresis: 0.1,
    // Evidence damping: copies + hearts + min(views * viewWeight, viewCap) against priorStrength.
    priorStrength: 12,
    evidence: { viewWeight: 0.05, viewCap: 50 },
    // Count signals: log1p, then a within-type percentile blended with a scale capped at the 95th percentile.
    normalization: { percentileShare: 0.7, scaleQuantile: 0.95 },
    freshness: { halfLifeDays: 180, shippingBonus: null },
    // "status": full credit only for verificationStatus === "verified".
    verification: { rule: "status" },
    installRate: null,
    // Installable listings with an HTTPS repository; retired/delisted status values are excluded.
    eligibility: { upstreamHealth: false },
    weights: { copies: 0.36, hearts: 0.2, stars: 0.18, views: 0.08, freshness: 0.13, verified: 0.05 }
  },
  {
    // Parameters chosen from the fixed-input comparison in docs/methodology-1.1.0.md.
    version: "1.1.0",
    hysteresis: 0.1,
    priorStrength: 12,
    evidence: { viewWeight: 0.05, viewCap: 50 },
    normalization: { percentileShare: 0.7, scaleQuantile: 0.95 },
    // The proposed shipping bonus was evaluated and deferred; freshness stays push-based.
    freshness: { halfLifeDays: 180, shippingBonus: null },
    // "coverage": snapshot-verified 1, update-unverified partial credit, anything else 0.
    verification: { rule: "coverage", updateUnverifiedCredit: 0.6 },
    // Wilson 95% lower bound of copies per detail view; unrated below 20 views.
    installRate: { minimumViews: 20, z: 1.96 },
    // Also excluded immediately: listings whose latest marketplace check failed or could not reach
    // the repository. Absent check results (older feeds) are not treated as failures.
    eligibility: { upstreamHealth: true },
    weights: { copies: 0.36, hearts: 0.2, stars: 0.18, views: 0.03, installRateLowerBound: 0.05, freshness: 0.13, verified: 0.05 }
  }
];

const REGISTRY = new Map(DEFINITIONS.map((definition) => [definition.version, deepFreeze(definition)]));

export const CURRENT_METHODOLOGY_VERSION = "1.1.0";

export function methodologyVersions() {
  return [...REGISTRY.keys()];
}

export function methodologyFor(version = LEGACY_METHODOLOGY_VERSION) {
  const key = version ?? LEGACY_METHODOLOGY_VERSION;
  const definition = REGISTRY.get(key);
  if (!definition) {
    throw new Error(
      `Unknown methodology version ${JSON.stringify(key)}; add its immutable definition to build/methodology.mjs`
    );
  }
  return definition;
}

// The methodology a published snapshot was calculated with, never the newest code's constants.
export function snapshotMethodology(snapshot) {
  return methodologyFor(snapshot?.methodologyVersion ?? LEGACY_METHODOLOGY_VERSION);
}

// Research variants for offline comparisons. They are never registered, so no snapshot can use them.
export function deriveMethodology(base, overrides, label) {
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = value && typeof value === "object" && !Array.isArray(value) && merged[key] && typeof merged[key] === "object"
      ? { ...merged[key], ...value }
      : value;
  }
  const weights = Object.values(merged.weights);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0) || Math.abs(total - 1) > 1e-9) {
    throw new Error(`Methodology variant ${label} weights must be non-negative and sum to 1 (got ${total})`);
  }
  merged.version = `${base.version}+${label}`;
  return deepFreeze(merged);
}
