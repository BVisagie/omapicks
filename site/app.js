const root = document.documentElement;
const themeButton = document.querySelector("[data-theme-toggle]");

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

if (filter) {
  applyFilter();
  filter.addEventListener("input", applyFilter);
  filter.addEventListener("search", applyFilter);
  filter.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const first = finderItems.find((item) => !item.hidden)?.querySelector("a");
    if (!first?.href) return;
    event.preventDefault();
    window.location.assign(first.href);
  });
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("Copy failed");
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
