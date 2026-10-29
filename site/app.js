const root = document.documentElement;
const themeButton = document.querySelector("[data-theme-toggle]");

for (const notice of document.querySelectorAll("[data-snapshot-at]")) {
  const ageDays = Math.floor((Date.now() - Date.parse(notice.dataset.snapshotAt)) / 86_400_000);
  if (Number.isFinite(ageDays) && ageDays > 8) {
    notice.textContent = `This snapshot is ${ageDays} days old. These picks come from the last successful publication.`;
    notice.hidden = false;
  }
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

const motionButton = document.querySelector("[data-motion-toggle]");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let motionPreference = "on";
try {
  if (localStorage.getItem("omapicks-motion") === "off") motionPreference = "off";
} catch {
  // Motion controls still work when browser storage is unavailable.
}

function applyMotion() {
  const enabled = !reducedMotion.matches && motionPreference === "on";
  root.dataset.motion = enabled ? "on" : "off";
  if (!motionButton) return;
  motionButton.hidden = false;
  motionButton.disabled = reducedMotion.matches;
  motionButton.textContent = reducedMotion.matches ? "Reduced motion" : enabled ? "Motion on" : "Motion off";
  motionButton.setAttribute("aria-pressed", String(enabled));
  motionButton.title = reducedMotion.matches
    ? "Respects your system’s reduced-motion preference"
    : "Toggle decorative animation";
}

applyMotion();
reducedMotion.addEventListener("change", applyMotion);
motionButton?.addEventListener("click", () => {
  motionPreference = motionPreference === "on" ? "off" : "on";
  applyMotion();
  try {
    localStorage.setItem("omapicks-motion", motionPreference);
  } catch {
    // Keep the selected motion setting for this page even without storage.
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
const filterJump = document.querySelector("[data-filter-jump]");
const collectionButtons = [...document.querySelectorAll("[data-collection-filter]")];
const filterResets = [...document.querySelectorAll("[data-filter-reset]")];
let activeCollection = "all";

function matchesQuery(node, query) {
  return !query || (node.dataset.search ?? "").includes(query);
}

function matchesCollection(node) {
  return activeCollection === "all" || (node.dataset.collections ?? "").split(/\s+/).includes(activeCollection);
}

function applyFilter() {
  if (!filter) return;
  const query = filter.value.trim().toLocaleLowerCase();
  const isFiltering = Boolean(query) || activeCollection !== "all";
  let visibleRows = 0;
  let visibleFinder = 0;

  for (const row of catalogRows) {
    const match = matchesCollection(row) && matchesQuery(row, query);
    row.hidden = !match;
    if (match) visibleRows += 1;
  }

  for (const item of finderItems) {
    const match = isFiltering
      ? matchesCollection(item) && matchesQuery(item, query)
      : item.hasAttribute("data-suggested");
    item.hidden = !match;
    if (match) visibleFinder += 1;
  }

  if (filterStatus) {
    const total = Number(filterStatus.dataset.total) || catalogRows.length;
    const visible = isFiltering ? visibleRows : visibleFinder;
    filterStatus.textContent = `${visible}/${total}`;
    filterStatus.setAttribute("aria-label", isFiltering
      ? `${visibleRows} of ${total} categories match`
      : `${visibleFinder} of ${total} suggested categories shown`);
  }
  if (filterEmpty) filterEmpty.hidden = !isFiltering || visibleRows > 0;
  if (finderEmpty) finderEmpty.hidden = !isFiltering || visibleFinder > 0;
  if (catalogHead) catalogHead.hidden = isFiltering && visibleRows === 0;
  if (filterJump) {
    filterJump.hidden = visibleRows === 0;
    filterJump.textContent = `View ${visibleRows} ${isFiltering ? "matching " : ""}${visibleRows === 1 ? "category" : "categories"} ↓`;
  }
  if (finderResults) {
    finderResults.setAttribute("aria-label", isFiltering ? "Matching categories" : "Suggested categories");
  }
  for (const button of collectionButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.collectionFilter === activeCollection));
  }
}

if (filter) {
  for (const button of collectionButtons) {
    button.hidden = false;
    button.addEventListener("click", () => {
      activeCollection = button.dataset.collectionFilter;
      applyFilter();
    });
  }
  for (const button of filterResets) {
    button.hidden = false;
    button.addEventListener("click", () => {
      filter.value = "";
      activeCollection = "all";
      applyFilter();
      filter.focus();
    });
  }
  applyFilter();
  filter.addEventListener("input", applyFilter);
  filter.addEventListener("search", applyFilter);
  filter.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      filter.value = "";
      applyFilter();
      return;
    }
    if (event.key !== "Enter" && event.key !== "ArrowDown") return;
    const first = finderItems.find((item) => !item.hidden)?.querySelector("a");
    if (!first?.href) return;
    event.preventDefault();
    if (event.key === "ArrowDown") first.focus();
    else window.location.assign(first.href);
  });
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || document.querySelector("dialog[open]")) return;
    if ([...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some((dialog) => dialog.getClientRects().length)) return;
    const editing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    const slash = event.key === "/" && !editing && !event.ctrlKey && !event.metaKey && !event.altKey;
    const command = event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey) && !event.altKey;
    if (!slash && !command) return;
    event.preventDefault();
    filter.focus();
  });
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
