import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  changesBetween,
  classifyPlugin,
  eligibilityReason,
  isoWeek,
  pickWithHysteresis,
  prepareTaxonomy,
  rankPlugins
} from "../build/rank.mjs";

const taxonomy = {
  schemaVersion: 1,
  types: [
    { id: "weather", name: "Weather", description: "Forecasts", include: ["\\bweather\\b"] },
    { id: "clock", name: "Clock", description: "Time", include: ["\\bclock\\b"] }
  ],
  overrides: { include: {}, exclude: {} }
};

function plugin(id, values = {}) {
  return {
    id,
    name: values.name ?? id,
    description: values.description ?? "Weather widget",
    category: "Widgets",
    tags: values.tags ?? [],
    installAvailable: values.installAvailable ?? true,
    installCommand: values.installCommand ?? `omarchy plugin add https://github.com/example/${id}.git`,
    repo: values.repo ?? `https://github.com/example/${id}`,
    repositoryUpdatedAt: values.repositoryUpdatedAt ?? "2026-08-01T00:00:00.000Z",
    verificationStatus: values.verificationStatus ?? "unverified",
    stars: values.stars ?? 0,
    previewThumbnail: null,
    ...values
  };
}

test("the production taxonomy is valid and intentionally broad", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  assert.equal(prepared.types.length, 41);
  assert.equal(new Set(prepared.types.map((type) => type.id)).size, prepared.types.length);
});

test("production taxonomy keeps real overlap and rejects accidental keyword hits", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  assert.deepEqual(
    typesOf({
      id: "io.github.r-witz.nothing-ear",
      name: "Nothing Audio",
      description:
        "Nothing earbuds and headphones in the Omarchy bar: battery, noise control, codec selection, and low-latency mode."
    }),
    ["battery", "audio"]
  );
  assert.deepEqual(
    typesOf({
      id: "nixfred.internet-latency",
      name: "Internet Latency",
      description: "Live color-coded internet latency with target selection, packet loss, jitter, and history."
    }),
    ["network"]
  );
  assert.deepEqual(
    typesOf({
      id: "jackzasian.clash-verge",
      name: "Clash Verge",
      description: "Clash Verge proxy status, node switching, latency testing and traffic in the Omarchy bar."
    }),
    ["network"]
  );
  assert.deepEqual(
    typesOf({
      id: "vitals",
      name: "Vitals",
      description: "Native Linux CPU, memory, GPU, storage, network, and process monitor"
    }),
    ["system-monitor", "network"]
  );
  assert.ok(
    !typesOf({
      id: "cam-stream",
      name: "Cam Stream",
      description: "Cam Stream keeps its low-latency camera preview as a normal movable window."
    }).includes("network")
  );
  assert.ok(
    !typesOf({
      id: "crueber.omacoin",
      name: "OmaCoin",
      description: "CoinGecko crypto tracker: USD price, volume, and 1h/1d/1w trend lines."
    }).includes("audio")
  );
  assert.ok(
    !typesOf({
      id: "stay-awake",
      name: "Stay Awake Indicators",
      description: "A Stay Awake cup that shows steam when another program is holding idle or sleep."
    }).includes("gaming")
  );
});

test("production taxonomy covers recurring jobs without bleeding into adjacent categories", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  assert.deepEqual(
    typesOf({
      id: "hyprmoncfg",
      name: "Multi-Monitor Manager",
      description: "Configure monitor layouts, per-display brightness, and workspaces across connected displays."
    }),
    ["display-monitors"]
  );
  assert.deepEqual(
    typesOf({
      id: "claude-usage",
      name: "Claude Usage",
      description: "Usage tracker for Claude quotas, token limits, and credits remaining."
    }),
    ["ai-api-usage"]
  );
  assert.deepEqual(
    typesOf({
      id: "stay-awake",
      name: "Stay Awake",
      description: "Prevent system sleep and suspend while long-running work completes."
    }),
    ["lock-idle"]
  );
  assert.deepEqual(
    typesOf({
      id: "theme-gallery",
      name: "Themes Gallery",
      description: "Browse and install Omarchy themes."
    }),
    ["themes-appearance"]
  );
  assert.deepEqual(
    typesOf({
      id: "home-assistant",
      name: "Home Assistant",
      description: "Control Home Assistant devices and smart lights."
    }),
    ["smart-home"]
  );
  assert.deepEqual(
    typesOf({
      id: "screen-time",
      name: "Screen Time",
      description: "Tracks screen time and desktop usage."
    }),
    ["screen-time"]
  );
  assert.deepEqual(
    typesOf({
      id: "todoist",
      name: "Todoist",
      description: "View and complete Todoist tasks."
    }),
    ["focus"]
  );
  assert.ok(
    !typesOf({
      id: "themed-weather",
      name: "Themed Weather",
      description: "A weather widget that follows the current theme."
    }).includes("themes-appearance")
  );
  assert.ok(
    !typesOf({
      id: "rgb-lighting",
      name: "RGB Lighting",
      description: "OpenRGB peripheral lighting with color presets and brightness controls."
    }).includes("brightness")
  );
});

test("mini-games ranks playable games without trainers, sports widgets, or chess stats", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  assert.deepEqual(
    typesOf({
      id: "omasweeper",
      name: "Omasweeper",
      description: "Minesweeper for omarchy-shell, drawn like a TUI: a character grid on hairlines, base-36 guesses."
    }),
    ["mini-games"]
  );
  assert.deepEqual(
    typesOf({
      id: "omarchy-chess",
      name: "Omarchy Chess",
      description: "Native, theme-aware chess for Omarchy with computer and local two-player modes."
    }),
    ["mini-games"]
  );
  assert.deepEqual(
    typesOf({
      id: "jhgundersen.snake",
      name: "Snake",
      description: "Something to do while the build's compiling and the agent's still thinking. Snake, in your top bar."
    }),
    ["mini-games"]
  );
  assert.ok(
    !typesOf({
      id: "omachess",
      name: "Omachess",
      description: "Chess.com in your Omarchy bar: live rating pill, a popup with bullet/blitz/rapid results."
    }).includes("mini-games")
  );
  assert.ok(
    !typesOf({
      id: "keycade",
      name: "Keycade",
      description: "Keycade — a shortcut recall arcade for Omarchy. It trains the shortcuts your machine actually uses."
    }).includes("mini-games")
  );
  assert.ok(
    !typesOf({
      id: "mlb-booth",
      name: "MLB Booth",
      description:
        "MLB Booth makes your chosen club legible at a glance: first-pitch countdowns before games, then score and inning."
    }).includes("mini-games")
  );
  assert.ok(
    !typesOf({
      id: "controller-control",
      name: "Controller Control",
      description: "Map any game controller's button combos to desktop shortcuts and commands."
    }).includes("mini-games")
  );
});

test("notes ranks capture tools without Hyprland scratchpads or incidental mentions", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  assert.deepEqual(
    typesOf({
      id: "obsidian-search",
      name: "Obsidian Search",
      description: "Search and open Obsidian notes from the Omarchy shell with fuzzy ranking, plus bases and canvases."
    }),
    ["notes"]
  );
  assert.deepEqual(
    typesOf({
      id: "omascratch",
      name: "Omascratch",
      description: "A quick-note scratchpad that docks to a screen corner."
    }),
    ["notes"]
  );
  assert.deepEqual(
    typesOf({
      id: "quick-capture",
      name: "Quick Capture",
      description: "A system-wide Markdown note capture panel for Omarchy."
    }),
    ["notes"]
  );
  assert.ok(
    !typesOf({
      id: "cassandra",
      name: "Cassandra",
      description: "Failed systemd units, journal errors, and coredumps in the bar."
    }).includes("notes")
  );
  assert.ok(
    !typesOf({
      id: "rob.scratchpad",
      name: "Scratchpad",
      description: "Scratchpad occupancy indicator and toggle"
    }).includes("notes")
  );
  assert.ok(
    !typesOf({
      id: "ianm.scratchpad",
      name: "Scratchpad placeholders",
      description: "Remember scratchpad apps across reboots and restore them as clickable placeholders."
    }).includes("notes")
  );
  assert.ok(
    !typesOf({
      id: "file-picker",
      name: "File Picker",
      description: "Fuzzy file selector and launcher for documents, media, markdown notes, and code"
    }).includes("notes")
  );
  assert.ok(
    !typesOf({
      id: "omarchycast",
      name: "Omarchycast",
      description:
        "Keyboard launcher for Omarchy with Raycast-style calculations and markdown notes — one hotkey."
    }).includes("notes")
  );
});

test("password-manager ranks vaults and TOTP without file lockers, compliance desks, or VPN MFA", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  assert.deepEqual(
    typesOf({
      id: "bw-vault",
      name: "BW Vault",
      description: "Bitwarden vault in the Omarchy bar, powered by the bw CLI."
    }),
    ["password-manager"]
  );
  assert.deepEqual(
    typesOf({
      id: "firefox-passwords",
      name: "Firefox Passwords",
      description: "Search, view, and copy Firefox saved logins from the bar, backed by firefox_decrypt"
    }),
    ["password-manager"]
  );
  assert.ok(
    !typesOf({
      id: "omarchy-openvpn-connect",
      name: "Omarchy OpenVPN Connect",
      description:
        "OpenVPN client for Omarchy — multi-profile .ovpn import, username/password + TOTP (MFA) challenge/response auth."
    }).includes("password-manager")
  );
  assert.ok(
    !typesOf({
      id: "omavault",
      name: "Omavault",
      description: "A secret vault for your files: unlock it from the bar, use it, and it locks itself again."
    }).includes("password-manager")
  );
  assert.ok(
    !typesOf({
      id: "compliantish",
      name: "Compliantish",
      description: "Local workstation checks for Omarchy: disk encryption, screen lock, antivirus, password manager."
    }).includes("password-manager")
  );
});

test("smart-home include catches WLED and key lights previously excluded from Brightness", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  assert.deepEqual(
    typesOf({
      id: "wled",
      name: "WLED",
      description: "Control WLED lights from the bar: power, brightness, and one click to a device's own web UI."
    }),
    ["smart-home"]
  );
  assert.deepEqual(
    typesOf({
      id: "elgato-keylight",
      name: "Elgato Key Light",
      description: "Elgato Key Light control: power, brightness, and color temperature for one or many lights."
    }),
    ["smart-home"]
  );
});

test("vpn matches provider names that fuse the acronym onto a prefix", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  // "\bvpn\b" could never match these: there is no word boundary before "vpn".
  assert.deepEqual(
    typesOf({
      id: "ivpn",
      name: "IVPN",
      description: "Connect, disconnect and pick a server for IVPN from the Omarchy bar."
    }),
    ["vpn"]
  );
  assert.deepEqual(
    typesOf({ id: "eduvpn", name: "eduVPN", description: "A focused eduVPN controller for the Omarchy bar." }),
    ["vpn"]
  );
});

test("music matches hyphenated now-playing, and screenshots matches reversed record wording", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  assert.deepEqual(
    typesOf({ id: "omadeezer", name: "OmaDeezer", description: "Deezer now-playing widget with playback controls" }),
    ["music"]
  );
  assert.deepEqual(
    typesOf({
      id: "omascreen",
      name: "Omascreen",
      description: "Record your screen and cut it into a finished video — capture, timeline, layers, subtitles and render."
    }),
    ["screenshots"]
  );
  assert.ok(
    !typesOf({
      id: "privacy-devices",
      name: "Privacy Devices",
      description:
        "Unified, configurable privacy indicators for microphones, audio playback, cameras, screen sharing, screenshots, screen recording, and location access."
    }).includes("screenshots")
  );
});

test("lock-idle covers lid, session-lock and idle-timeout wording", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  assert.deepEqual(
    typesOf({
      id: "sandman",
      name: "Sandman",
      description: "Set lid-close actions and when your screen rests, locks, sleeps, and hibernates."
    }),
    ["lock-idle"]
  );
  assert.deepEqual(
    typesOf({
      id: "locksigil",
      name: "LockSigil",
      description: "Quickshell session lock with separate password and fingerprint PAM flows."
    }),
    ["lock-idle"]
  );
  // A screensaver *timing* tool belongs here, not in the Screensavers ranking.
  const ristretto = typesOf({
    id: "ristretto",
    name: "Ristretto",
    description: "Screensaver, lock, and sleep-after-idle-lock timing control."
  });
  assert.ok(ristretto.includes("lock-idle"));
  assert.ok(!ristretto.includes("screensavers"));
});

test("ai-api-usage covers agent and subscription usage without swallowing cloud dashboards", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  assert.ok(
    typesOf({
      id: "agent-usage-plus",
      name: "Agent Usage Plus",
      description: "Live AI coding-subscription usage, limits, API-rate estimates, and token history in a native bar panel."
    }).includes("ai-api-usage")
  );
  assert.ok(
    typesOf({
      id: "token-maxxer-hub",
      name: "Token Maxxer Hub",
      description: "A local-first multi-account usage hub for sessions, quotas, balances, and alerts across 17 AI integrations."
    }).includes("ai-api-usage")
  );
  assert.ok(
    !typesOf({
      id: "cloudflare",
      name: "Cloudflare",
      description: "Cloudflare account resources, deployment status, usage meters, and dashboard token shortcuts in the bar."
    }).includes("ai-api-usage")
  );
});

test("radio ranks streaming players without ham radio, autoplay radio, or radio-effect players", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  assert.deepEqual(
    typesOf({
      id: "radio-atlas",
      name: "Radio Atlas",
      description: "Explore live radio on a rotatable globe and play stations through Omarchy's media controls."
    }),
    ["radio"]
  );
  assert.ok(
    typesOf({
      id: "radiogram",
      name: "Radiogram",
      description: "Control Radiogram web radio from the Omarchy bar. Shows the current station and play/pause state."
    }).includes("radio")
  );
  assert.ok(
    !typesOf({
      id: "qrz",
      name: "QRZ",
      description: "Look up amateur radio callsigns on QRZ.com from the bar or a keyboard shortcut"
    }).includes("radio")
  );
  assert.ok(
    !typesOf({
      id: "ham-radio",
      name: "Ham Radio",
      description: "HF band conditions in the Omarchy bar: which band is open now, day and night, with the solar index."
    }).includes("radio")
  );
  assert.ok(
    !typesOf({
      id: "yt-mini",
      name: "YT Mini",
      description: "Small floating YouTube window owned by the Omarchy shell: clipboard handoff, playlists, radio auto-advance."
    }).includes("radio")
  );
  // A music player that merely *sounds* like a radio is not a radio player.
  const omampy = typesOf({
    id: "omampy",
    name: "OMAMPY",
    description: "A local music player that makes your files sound like a 1980s MW/SW radio broadcast."
  });
  assert.ok(omampy.includes("music"));
  assert.ok(!omampy.includes("radio"));
});

test("screensavers ranks actual savers, not suppressors or togglers", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  assert.deepEqual(
    typesOf({
      id: "nvim-screensaver",
      name: "Nvim Screensaver",
      description: "Screensaver that replays your recent git commits as a live Neovim editing session"
    }),
    ["screensavers"]
  );
  assert.ok(
    typesOf({
      id: "omarcharium",
      name: "Omarcharium",
      description: "A living TTE-inspired tropical aquarium screensaver with a tray-hosted control room."
    }).includes("screensavers")
  );
  assert.ok(
    !typesOf({
      id: "hey-im-gaming-here",
      name: "Hey! I'm Gaming Here!",
      description:
        "Detects Steam/Lutris/Heroic/Bottles game sessions and keeps the screensaver and lock screen off while you're actually playing."
    }).includes("screensavers")
  );
  assert.ok(
    !typesOf({
      id: "screensaver-and-lock",
      name: "Screensaver & Lock",
      description: "Bar toggle that switches the screensaver and idle screen lock off and on."
    }).includes("screensavers")
  );
  assert.ok(
    !typesOf({
      id: "idle-screencounter",
      name: "Idle Screen Counter",
      description: "A theme-aware split-flap countdown before Omarchy starts the screensaver."
    }).includes("screensavers")
  );
});

test("power-menu, plugin-manager, firewall and dev-ports rank their own clusters", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  assert.deepEqual(
    typesOf({
      id: "simple-power-menu",
      name: "Simple Power Menu",
      description: "A compact, customizable power menu anchored to the Omarchy bar"
    }),
    ["power-menu"]
  );
  // Excluded by id override: a dock whose "System menu" mention is incidental.
  assert.ok(
    !typesOf({
      id: "primo.dock",
      name: "PrimoDock",
      description: "Application dock for Omarchy. A Super-held System menu handles pinning and custom icon overrides."
    }).includes("power-menu")
  );

  assert.ok(
    typesOf({
      id: "okomart",
      name: "Okomart",
      description: "Browse, install, enable, disable, update, and remove Omarchy plugins from a storefront interface"
    }).includes("plugin-manager")
  );
  assert.ok(
    !typesOf({
      id: "plugin-guard",
      name: "Plugin Guard",
      description: "Security scanner for your installed Omarchy plugins — static behavior analysis with an offline report."
    }).includes("plugin-manager")
  );
  assert.ok(
    !typesOf({
      id: "plugin-pulse",
      name: "Plugin Pulse",
      description: "Local runtime observability for enabled Omarchy plugins, their processes, reloads, source cues, and shell errors."
    }).includes("plugin-manager")
  );
  assert.ok(
    !typesOf({
      id: "plugin-settings",
      name: "Plugin Settings",
      description: "Configure the Omarchy shell and schema-enabled plugins."
    }).includes("plugin-manager")
  );

  assert.deepEqual(
    typesOf({ id: "omawall", name: "Omawall", description: "View and manage the Omarchy UFW firewall from the bar." }),
    ["firewall"]
  );
  assert.ok(
    !typesOf({
      id: "windscribe",
      name: "Windscribe",
      description: "Windscribe controls for Omarchy in a terminal-grade panel: one-key connect, live traffic, firewall."
    }).includes("firewall")
  );

  assert.ok(
    typesOf({
      id: "portboard",
      name: "Portboard",
      description: "Summonable panel of listening localhost ports with owning process and cwd."
    }).includes("dev-ports")
  );
  assert.ok(
    typesOf({
      id: "harbor",
      name: "Harbor",
      description: "Answers the EADDRINUSE moment: type a port to learn it's free, get the next free port, and kill it."
    }).includes("dev-ports")
  );
  assert.ok(
    !typesOf({
      id: "my-network",
      name: "My Network",
      description: "Scans the local subnet and identifies every device on it: name, vendor, model, mDNS and open ports."
    }).includes("dev-ports")
  );
});

test("classification supports multiple legitimate app types and overrides", () => {
  const prepared = prepareTaxonomy(taxonomy);
  assert.deepEqual(
    classifyPlugin(plugin("combo", { description: "A weather clock for the bar" }), prepared),
    ["weather", "clock"]
  );

  const overridden = prepareTaxonomy({
    ...taxonomy,
    overrides: { include: { special: ["clock"] }, exclude: { special: ["weather"] } }
  });
  assert.deepEqual(classifyPlugin(plugin("special"), overridden), ["clock"]);
});

test("eligibility fails closed for unavailable plugins and unsafe repositories", () => {
  assert.equal(eligibilityReason(plugin("ok")), null);
  assert.equal(eligibilityReason(plugin("missing", { installAvailable: false })), "not-installable");
  assert.equal(eligibilityReason(plugin("unsafe", { repo: "http://example.test/plugin" })), "invalid-repository");
  assert.equal(eligibilityReason(plugin("retired", { status: "retired" })), "retired");
});

test("ISO weeks handle year boundaries", () => {
  assert.equal(isoWeek(new Date("2026-01-01T00:00:00Z")), "2026-W01");
  assert.equal(isoWeek(new Date("2027-01-01T00:00:00Z")), "2026-W53");
});

test("ranking is deterministic, dampens sparse entries, and permits a one-item cohort", () => {
  const catalog = [
    plugin("popular", { stars: 80 }),
    plugin("sparse", { stars: 1 }),
    plugin("clock-only", { description: "Minimal clock" })
  ];
  const stats = {
    popular: { copies: 100, hearts: 40, views: 1000 },
    sparse: { copies: 1, hearts: 0, views: 3 },
    "clock-only": { copies: 4, hearts: 1, views: 20 }
  };
  const input = { catalog, stats, taxonomy, now: new Date("2026-09-01T09:00:00Z") };
  const first = rankPlugins(input);
  const second = rankPlugins(input);
  assert.deepEqual(first, second);
  const weather = first.rankings.types.find((type) => type.id === "weather");
  const clock = first.rankings.types.find((type) => type.id === "clock");
  assert.equal(weather.winner.id, "popular");
  assert.ok(weather.winner.evidence > weather.runnerUp.evidence);
  assert.equal(clock.winner.id, "clock-only");
  assert.equal(clock.runnerUp, null);
});

test("hysteresis retains close incumbents and replaces clearly beaten ones", () => {
  const close = [{ id: "challenger", score: 0.75 }, { id: "incumbent", score: 0.7 }];
  assert.equal(pickWithHysteresis(close, "incumbent").id, "incumbent");
  const decisive = [{ id: "challenger", score: 0.79 }, { id: "incumbent", score: 0.7 }];
  assert.equal(pickWithHysteresis(decisive, "incumbent").id, "challenger");
  assert.equal(pickWithHysteresis(close, "missing").id, "challenger");
});

test("champion changes distinguish first picks, displacement, and vacancy", () => {
  const previous = {
    types: [
      { id: "weather", name: "Weather", winner: { id: "old", name: "Old" } },
      { id: "clock", name: "Clock", winner: { id: "clock", name: "Clock" } }
    ]
  };
  const current = {
    types: [
      { id: "weather", name: "Weather", winner: { id: "new", name: "New" } },
      { id: "clock", name: "Clock", winner: null },
      { id: "mail", name: "Mail", winner: { id: "mail", name: "Mail" } }
    ]
  };
  assert.deepEqual(
    changesBetween(previous, current).map((change) => change.kind),
    ["displaced", "vacated", "new-champion"]
  );
});
