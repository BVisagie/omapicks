import { snapshotMethodology } from "./methodology.mjs";

export function publicationReference(snapshot) {
  return snapshot?.week ? { week: snapshot.week, generatedAt: snapshot.generatedAt,
    methodologyVersion: snapshotMethodology(snapshot).version } : null;
}

// Each methodology has its own event set. Preserve the superseded snapshot with its
// original contracts, evidence and events instead of relabeling or discarding them.
export function publicationHistory(previous, current, existingHistory) {
  const sameWeek = existingHistory?.week === current.week;
  const sameMethod = sameWeek && snapshotMethodology(existingHistory).version === snapshotMethodology(current).version;
  const supersededPublications = sameWeek ? [...(existingHistory.supersededPublications ?? [])] : [];
  if (sameWeek && !sameMethod) {
    const { supersededPublications: ignored, ...superseded } = existingHistory;
    supersededPublications.push(superseded);
  }
  return {
    publicationBaseline: sameMethod ? existingHistory.publicationBaseline ?? publicationReference(previous) : publicationReference(previous),
    supersededPublications
  };
}

export function historyPublications(history) {
  return history.flatMap((snapshot) => [
    ...(snapshot.supersededPublications ?? []).map((publication) => ({ ...publication, superseded: true })),
    snapshot
  ]);
}

export function publicationAnchor(snapshot) {
  return `publication-${String(snapshot.week).replace(/[^a-zA-Z0-9-]/g, "")}-${String(snapshot.generatedAt ?? snapshot.methodologyVersion ?? "original").replace(/[^a-zA-Z0-9]/g, "")}`;
}
