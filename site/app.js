const root = document.documentElement;
const themeButton = document.querySelector("[data-theme-toggle]");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;

// Styles that depend on JavaScript (scroll reveals, tilt) key off this class so that without
// scripts every element simply renders in its final state.
root.classList.add("js");

// Glass tiles: the cursor position lights the border and spotlight; .tilt tiles lean toward it.
document.addEventListener("pointermove", (event) => {
  const tile = event.target.closest?.(".glass");
  if (!tile) return;
  const rect = tile.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  tile.style.setProperty("--mx", `${x}px`);
  tile.style.setProperty("--my", `${y}px`);
  if (tile.classList.contains("tilt") && finePointer && !reduceMotion) {
    tile.style.setProperty("--rx", `${((0.5 - y / rect.height) * 8).toFixed(2)}deg`);
    tile.style.setProperty("--ry", `${((x / rect.width - 0.5) * 8).toFixed(2)}deg`);
  }
  if (tile.classList.contains("parallax") && finePointer && !reduceMotion) {
    // The preview drifts a few pixels against the cursor.
    tile.style.setProperty("--px", ((x / rect.width - 0.5) * -2).toFixed(3));
    tile.style.setProperty("--py", ((y / rect.height - 0.5) * -2).toFixed(3));
  }
}, { passive: true });

document.addEventListener("pointerout", (event) => {
  const tile = event.target.closest?.(".glass");
  if (!tile || tile.contains(event.relatedTarget)) return;
  for (const name of ["--rx", "--ry", "--px", "--py"]) tile.style.removeProperty(name);
});

// Numbers count up and sections reveal as they scroll into view; reduced motion shows final values.
function countUp(element) {
  const target = Number.parseFloat(element.dataset.count);
  if (!Number.isFinite(target)) return;
  const decimals = Number(element.dataset.decimals || 0);
  const suffix = element.dataset.suffix || "";
  const format = (value) => (decimals ? value.toFixed(decimals) : Math.round(value).toLocaleString("en-US")) + suffix;
  if (reduceMotion) { element.textContent = format(target); return; }
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / 1300);
    element.textContent = format(target * (1 - (1 - progress) ** 3));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const revealObserver = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add("is-in");
    for (const counter of entry.target.querySelectorAll("[data-count]")) countUp(counter);
    revealObserver.unobserve(entry.target);
  }
}, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" }) : null;

for (const element of document.querySelectorAll(".reveal, [data-animate]")) {
  if (revealObserver) revealObserver.observe(element);
  else element.classList.add("is-in");
}

for (const notice of document.querySelectorAll("[data-snapshot-at]")) {
  const ageDays = Math.floor((Date.now() - Date.parse(notice.dataset.snapshotAt)) / 86_400_000);
  if (Number.isFinite(ageDays) && ageDays > 8) {
    notice.textContent = `This snapshot is ${ageDays} days old. These picks come from the last successful publication.`;
    notice.hidden = false;
  }
}

for (const notice of document.querySelectorAll("[data-availability-at]")) {
  const hours = Math.floor((Date.now() - Date.parse(notice.dataset.availabilityAt)) / 3_600_000);
  if (!Number.isFinite(hours) || hours < 0) continue;
  const days = Math.floor(hours / 24);
  notice.textContent = hours < 1 ? " (less than an hour ago)" : days > 0
    ? ` (${days} ${days === 1 ? "day" : "days"} ago)`
    : ` (${hours} ${hours === 1 ? "hour" : "hours"} ago)`;
}

function storedTheme() {
  try {
    return localStorage.getItem("omapicks-theme");
  } catch {
    return null;
  }
}

function setTheme(theme) {
  root.dataset.theme = theme;
  if (themeButton) {
    const next = theme === "dark" ? "light" : "dark";
    themeButton.setAttribute("aria-label", `Switch to ${next} theme`);
    themeButton.setAttribute("aria-pressed", String(theme === "dark"));
  }
}

setTheme(
  root.dataset.theme === "light" || root.dataset.theme === "dark"
    ? root.dataset.theme
    : storedTheme() || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
);

themeButton?.addEventListener("click", () => {
  const theme = root.dataset.theme === "dark" ? "light" : "dark";
  setTheme(theme);
  try {
    localStorage.setItem("omapicks-theme", theme);
  } catch {
    // The selected theme still applies when storage is unavailable.
  }
});

const filter = document.querySelector("[data-pick-filter]");
const catalogRows = [...document.querySelectorAll("[data-catalog-row]")];
const finderItems = [...document.querySelectorAll("[data-finder-item]")];
const finderResults = document.querySelector("[data-finder-results]");
const filterStatus = document.querySelector("[data-filter-status]");
const filterEmpty = document.querySelector("[data-filter-empty]");
const finderEmpty = document.querySelector("[data-finder-empty]");
const catalogHead = document.querySelector("[data-catalog-head]");

function matchesQuery(node, query) {
  return !query || (node.dataset.search ?? "").includes(query);
}

function applyFilter() {
  if (!filter) return;
  const query = filter.value.trim().toLocaleLowerCase();
  let visibleRows = 0;
  let visibleFinder = 0;

  for (const row of catalogRows) {
    const match = matchesQuery(row, query);
    row.hidden = !match;
    if (match) visibleRows += 1;
  }

  for (const item of finderItems) {
    const match = query ? matchesQuery(item, query) : item.hasAttribute("data-suggested");
    item.hidden = !match;
    if (match) visibleFinder += 1;
  }

  if (filterStatus) {
    const total = Number(filterStatus.dataset.total) || catalogRows.length;
    const visible = query ? visibleRows : visibleFinder;
    filterStatus.textContent = `${visible}/${total}`;
    filterStatus.setAttribute("aria-label", query
      ? `${visibleRows} of ${total} categories match`
      : `${visibleFinder} of ${total} suggested categories shown`);
  }
  if (filterEmpty) filterEmpty.hidden = !query || visibleRows > 0;
  if (finderEmpty) finderEmpty.hidden = !query || visibleFinder > 0;
  if (catalogHead) catalogHead.hidden = Boolean(query) && visibleRows === 0;
  if (finderResults) {
    finderResults.setAttribute("aria-label", query ? "Matching categories" : "Suggested categories");
  }
}

const visibleFinderLinks = () => finderItems.filter((item) => !item.hidden).map((item) => item.querySelector("a"));

if (filter) {
  applyFilter();
  filter.addEventListener("input", applyFilter);
  filter.addEventListener("search", applyFilter);
  filter.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      const first = visibleFinderLinks()[0];
      if (first) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.key !== "Enter") return;
    const first = visibleFinderLinks()[0];
    if (!first?.href) return;
    event.preventDefault();
    window.location.assign(first.href);
  });
}

// Arrow keys move focus through the visible results; typing returns to the search box.
finderResults?.addEventListener("keydown", (event) => {
  const links = visibleFinderLinks();
  const index = links.indexOf(document.activeElement);
  if (index < 0) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = links[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) next.focus();
    else if (event.key === "ArrowUp") filter?.focus();
  } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    filter?.focus();
  }
});

// Palette: the hero finder itself moves into a dialog overlay, so there is one input and one
// list whether it is used inline or as a command palette. Triggers are hidden without scripts.
const finder = document.querySelector(".hero-finder");
const palette = document.querySelector("[data-palette]");
const paletteSlot = palette?.querySelector("[data-palette-slot]");
const finderHint = finder?.querySelector("[data-finder-hint]");
let finderPlaceholder = null;
let paletteReturnFocus = null;

function openPalette() {
  if (!palette || !finder || !palette.hidden) return;
  paletteReturnFocus = document.activeElement;
  finderPlaceholder = document.createComment("finder");
  finder.replaceWith(finderPlaceholder);
  paletteSlot.append(finder);
  finder.classList.add("is-palette");
  if (finderHint) finderHint.hidden = false;
  palette.hidden = false;
  document.body.style.overflow = "hidden";
  filter?.focus();
  filter?.select();
}

function closePalette() {
  if (!palette || palette.hidden) return;
  palette.hidden = true;
  document.body.style.overflow = "";
  finder.classList.remove("is-palette");
  if (finderHint) finderHint.hidden = true;
  finderPlaceholder?.replaceWith(finder);
  finderPlaceholder = null;
  paletteReturnFocus?.focus?.();
}

if (palette && finder && filter) {
  for (const trigger of document.querySelectorAll("[data-open-palette]")) {
    trigger.hidden = false;
    trigger.addEventListener("click", openPalette);
  }
  palette.querySelector("[data-palette-close]")?.addEventListener("click", closePalette);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !palette.hidden) { event.preventDefault(); closePalette(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "");
    if ((event.key === "k" || event.key === "K") && (event.ctrlKey || event.metaKey)) { event.preventDefault(); openPalette(); }
    else if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); openPalette(); }
    else if (event.key === "Tab" && !palette.hidden) {
      // Keep focus inside the dialog: cycle between the search box and the visible results.
      const stops = [filter, ...visibleFinderLinks()];
      const index = stops.indexOf(document.activeElement);
      const next = stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length];
      if (next) { event.preventDefault(); next.focus(); }
    }
  });
}

// Decode headline: the server renders the final text; the effect is transient and aria-hidden,
// and the plain heading is restored as soon as it finishes.
const heroHeading = document.querySelector(".hero h1");
if (heroHeading && !reduceMotion && heroHeading.children.length === 0) {
  const text = heroHeading.textContent;
  const live = document.createElement("span");
  live.className = "visually-hidden";
  live.textContent = text;
  const scramble = document.createElement("span");
  scramble.className = "decode";
  scramble.setAttribute("aria-hidden", "true");
  scramble.textContent = text;
  heroHeading.replaceChildren(live, scramble);
  const glyphs = "▒░█/\\|_-=+<>*#01{}[]";
  const start = performance.now();
  let frame = 0;
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / 950);
    let out = "";
    for (let i = 0; i < text.length; i += 1) {
      const threshold = (i / text.length) * 0.8 + 0.12;
      out += text[i] === " " || progress >= threshold ? text[i]
        : (frame % 2 === 0 || i % 3 === 0) ? glyphs[Math.floor(Math.random() * glyphs.length)] : scramble.textContent[i] || text[i];
    }
    scramble.textContent = out;
    frame += 1;
    if (progress < 1) requestAnimationFrame(tick);
    else heroHeading.textContent = text;
  };
  requestAnimationFrame(tick);
}

// Radar: one node per category, read from the finder list already in the page. Four
// counter-rotating rings and a sweep; hover reads the leading option, click opens the category.
const radarPanel = document.querySelector("[data-radar]");
const radarCanvas = radarPanel?.querySelector("canvas");
if (radarPanel && radarCanvas && finderItems.length && radarCanvas.getContext) {
  const ctx = radarCanvas.getContext("2d");
  const categoryOut = radarPanel.querySelector("[data-radar-category]");
  const pickOut = radarPanel.querySelector("[data-radar-pick]");
  const entries = finderItems.map((item) => ({
    name: item.querySelector("span")?.textContent.trim() ?? "",
    pick: item.querySelector("strong")?.textContent.trim() ?? "",
    href: item.querySelector("a")?.getAttribute("href") ?? ""
  }));
  const rings = [{ r: 0.34, n: 10, w: 0.06 }, { r: 0.54, n: 14, w: -0.04 }, { r: 0.74, n: 18, w: 0.03 }, { r: 0.94, n: 999, w: -0.02 }];
  const nodes = [];
  let k = 0;
  rings.forEach((ring, ringIndex) => {
    const count = ring.n === 999 ? entries.length - k : Math.min(ring.n, entries.length - k);
    for (let i = 0; i < count; i += 1, k += 1) {
      nodes.push({ ...entries[k], ring: ringIndex, base: (i / count) * Math.PI * 2 + ringIndex * 0.37, x: 0, y: 0 });
    }
  });
  let size = 0;
  let pointer = null;
  let hovered = null;
  let sweep = 0;
  let last = performance.now();
  let raf = 0;
  let running = false;
  let colors = {};
  const css = () => getComputedStyle(root);
  const readColors = () => {
    const style = css();
    colors = { accent: style.getPropertyValue("--accent").trim(), ink: style.getPropertyValue("--ink").trim(), line: style.getPropertyValue("--line").trim() };
  };
  const rgba = (hex, alpha) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  };
  function draw(time) {
    if (!size) return;
    const c = size / 2;
    const R = c - 12;
    ctx.clearRect(0, 0, size, size);
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.line;
    for (const ring of rings) { ctx.beginPath(); ctx.arc(c, c, R * ring.r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(c - R, c); ctx.lineTo(c + R, c); ctx.moveTo(c, c - R); ctx.lineTo(c, c + R); ctx.stroke();
    if (typeof ctx.createConicGradient === "function") {
      const gradient = ctx.createConicGradient(sweep - 1.1, c, c);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(0.175, rgba(colors.accent, 0.28));
      gradient.addColorStop(0.176, "rgba(0,0,0,0)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = rgba(colors.accent, 0.9);
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(sweep) * R, c + Math.sin(sweep) * R); ctx.stroke();
    let nearest = null;
    let nearestDistance = 24;
    for (const node of nodes) {
      const ring = rings[node.ring];
      const angle = node.base + (reduceMotion ? 0 : time * ring.w);
      node.x = c + Math.cos(angle) * R * ring.r;
      node.y = c + Math.sin(angle) * R * ring.r;
      const behind = (((sweep - angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const glow = behind < 1.1 ? 1 - behind / 1.1 : 0;
      if (pointer) {
        const distance = Math.hypot(pointer.x - node.x, pointer.y - node.y);
        if (distance < nearestDistance) { nearestDistance = distance; nearest = node; }
      }
      if (glow > 0) {
        ctx.fillStyle = rgba(colors.accent, glow * 0.22);
        ctx.beginPath(); ctx.arc(node.x, node.y, 3 + glow * 6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = rgba(colors.accent, 0.42 + glow * 0.58);
      ctx.beginPath(); ctx.arc(node.x, node.y, 2 + glow * 1.4, 0, Math.PI * 2); ctx.fill();
    }
    if (nearest) {
      ctx.strokeStyle = rgba(colors.accent, 0.9);
      ctx.beginPath(); ctx.arc(nearest.x, nearest.y, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = rgba(colors.accent, 0.5);
      ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(nearest.x, nearest.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = colors.ink;
      ctx.font = `600 11px ${css().getPropertyValue("--mono")}`;
      ctx.textAlign = nearest.x > c ? "right" : "left";
      ctx.fillText(nearest.name.toLowerCase(), nearest.x + (nearest.x > c ? -12 : 12), nearest.y + 4);
    }
    if (nearest !== hovered) {
      hovered = nearest;
      if (categoryOut) categoryOut.textContent = nearest ? nearest.name.toLowerCase() : "hover a node";
      if (pickOut) pickOut.textContent = nearest ? `→ ${nearest.pick}` : "—";
      radarCanvas.style.cursor = nearest ? "pointer" : "crosshair";
    }
  }
  function frame(now) {
    sweep += Math.min(0.05, (now - last) / 1000) * 0.85;
    last = now;
    draw(now / 1000);
    raf = requestAnimationFrame(frame);
  }
  const start = () => { if (running || reduceMotion) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); };
  const stop = () => { running = false; cancelAnimationFrame(raf); };
  function resize() {
    const rect = radarCanvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    size = rect.width;
    radarCanvas.width = Math.round(size * dpr);
    radarCanvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(performance.now() / 1000);
  }
  radarCanvas.addEventListener("pointermove", (event) => {
    const rect = radarCanvas.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (reduceMotion) draw(0);
  });
  radarCanvas.addEventListener("pointerleave", () => { pointer = null; if (reduceMotion) draw(0); });
  radarCanvas.addEventListener("click", () => { if (hovered?.href) window.location.assign(hovered.href); });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  themeButton?.addEventListener("click", () => { readColors(); if (reduceMotion) draw(0); });
  radarPanel.hidden = false;
  readColors();
  new ResizeObserver(resize).observe(radarCanvas);
  resize();
  start();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers expose Clipboard API but deny writes. Try the selection fallback.
    }
  }
  const area = document.createElement("textarea");
  const activeElement = document.activeElement;
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    area.remove();
    activeElement?.focus();
  }
  if (!copied) throw new Error("Copy failed");
}

for (const button of document.querySelectorAll("[data-copy-link]")) {
  button.hidden = false;
  button.addEventListener("click", async () => {
    const status = button.closest(".share-links")?.querySelector("[data-share-status]");
    if (status) status.textContent = "";
    try {
      await copyText(button.dataset.copyLink);
      if (status) status.textContent = "Link copied.";
    } catch {
      if (status) status.textContent = "Could not copy the link. Copy the address from your browser or use Email.";
    }
  });
}

for (const button of document.querySelectorAll("[data-share-url]")) {
  if (typeof navigator.share !== "function") continue;
  button.hidden = false;
  button.addEventListener("click", async () => {
    const status = button.closest(".share-links")?.querySelector("[data-share-status]");
    if (status) status.textContent = "";
    try {
      await navigator.share({ title: "OmaPicks", text: button.dataset.shareText, url: button.dataset.shareUrl });
    } catch (error) {
      if (error.name !== "AbortError" && status) status.textContent = "Could not open sharing. Use Copy link or Email.";
    }
  });
}

for (const button of document.querySelectorAll("[data-copy-command]")) {
  button.addEventListener("click", async () => {
    const command = button.closest(".command-row")?.querySelector("code")?.textContent ?? "";
    const label = button.dataset.copyLabel || "text";
    const original = button.textContent;
    const originalLabel = button.getAttribute("aria-label");
    try {
      await copyText(command);
      button.textContent = "Copied";
      button.setAttribute("aria-label", `${label} copied`);
    } catch {
      button.textContent = "Select";
      button.setAttribute("aria-label", `Select ${label} manually`);
    }
    window.setTimeout(() => {
      button.textContent = original;
      if (originalLabel) button.setAttribute("aria-label", originalLabel);
      else button.removeAttribute("aria-label");
    }, 1800);
  });
}
