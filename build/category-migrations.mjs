import { methodologyVersions, snapshotMethodology } from "./methodology.mjs";

const change = (id, name, successors, reason, retired = true) => ({
  from: { id, name }, to: successors.map(([id, name]) => ({ id, name })),
  kind: successors.length > 1 ? "split" : "narrowed", retired, reason
});

// Published migration descriptions are immutable. A retired route is an explanation,
// not a redirect to one arbitrarily chosen successor of a one-to-many split.
export const CATEGORY_MIGRATIONS = [{
  id: "task-coherence-2026-10-30",
  methodologyVersion: "1.4.0",
  description: "Recommendations now share a specific task and target. Separate tasks have their own shortlists; specialist tools do not substitute for a missing core workflow.",
  changes: [
    change("lock-idle", "Lock & Idle", [["lock-screen", "Lock Screen Appearance"], ["idle-sleep", "Idle & Sleep Settings"], ["keep-awake", "Keep Awake"]], "Choosing a lock-screen design, configuring automatic idle actions and temporarily keeping the computer awake are separate tasks."),
    change("clock-timer", "Clocks & Time Zones", [["desktop-clocks", "Desktop Clocks"], ["world-clocks", "World Clocks & Time Zones"]], "Displaying a desktop clock does not establish the ability to compare time zones."),
    change("ai-assistant", "Agent Sessions", [["agent-monitoring", "Agent Monitoring"], ["agent-history", "Session History & Resume"]], "Inspecting running agents and resuming an archived conversation require different controls."),
    change("uptime-monitoring", "Uptime Monitoring", [["endpoint-monitoring", "Endpoint & Service Monitoring"], ["service-status", "Service Status & Incidents"]], "Checks of configured targets are distinct from provider-published incident reports."),
    change("weather", "Weather", [["weather", "Weather Forecasts"], ["weather-radar", "Weather Radar"]], "General conditions and forecasts are separate from precipitation radar imagery.", false),
    change("network", "Network Connections", [["network", "Network Connections"], ["hotspots", "Hotspots & Internet Sharing"]], "Joining a network and sharing an existing connection through a hotspot are separate tasks.", false),
    change("firewall", "Firewall", [["firewall", "Firewall Rules"], ["app-network-blocking", "App Network Blocking"]], "Host port and address rules are distinct from blocking one application's outbound traffic.", false)
  ]
}];

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
freeze(CATEGORY_MIGRATIONS);

export function migrationsForSnapshot(snapshot) {
  const versions = methodologyVersions();
  const index = versions.indexOf(snapshotMethodology(snapshot).version);
  return CATEGORY_MIGRATIONS.filter((migration) => versions.indexOf(migration.methodologyVersion) <= index);
}

export function taskDefinitionChanged(before, after) {
  if (!before?.taskContract || !after?.taskContract) return false;
  const requirements = ({ version, capabilitySets }) => JSON.stringify({ version,
    capabilitySets: capabilitySets.map((set) => [...set].sort()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
  return requirements(before.taskContract) !== requirements(after.taskContract);
}

export function categoryChangesBetween(previous, current) {
  if (!previous?.types?.length || !snapshotMethodology(current).eligibility.taskCoherence) return [];
  const priorMigrations = new Set(migrationsForSnapshot(previous).map((m) => m.id));
  const prior = new Map(previous.types.map((t) => [t.id, t]));
  const types = new Map(current.types.map((t) => [t.id, t]));
  const result = [];
  for (const migration of migrationsForSnapshot(current)) {
    if (priorMigrations.has(migration.id)) continue;
    for (const entry of migration.changes) {
      if (!prior.has(entry.from.id) || !entry.to.every((t) => types.has(t.id))) continue;
      if (entry.retired && types.has(entry.from.id)) continue;
      result.push({ ...entry, migrationId: migration.id });
    }
  }
  const covered = new Set(result.map((entry) => entry.from.id));
  for (const type of current.types) {
    const old = prior.get(type.id);
    const requalified = taskDefinitionChanged(old, type);
    const clarified = old?.taskContract && type.taskContract && old.taskContract.outcome !== type.taskContract.outcome;
    if (!covered.has(type.id) && (requalified || clarified)) {
      result.push({ from: { id: old.id, name: old.name }, to: [{ id: type.id, name: type.name }],
        kind: requalified ? "narrowed" : "clarified", retired: false,
        reason: requalified
          ? `The minimum task is now: ${type.taskContract.outcome}. Earlier selections were reviewed against the previous definition.`
          : `The task description is clarified: ${type.taskContract.outcome}. Qualification requirements and existing reviews are unchanged.` });
    }
  }
  return result;
}
