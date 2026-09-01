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
    : storedTheme() || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
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
const filterables = [...document.querySelectorAll("[data-pick-section]")];
const catalogRows = [...document.querySelectorAll("[data-catalog-row]")];
const filterStatus = document.querySelector("[data-filter-status]");
const filterEmpty = document.querySelector("[data-filter-empty]");
const catalogHead = document.querySelector("[data-catalog-head]");

function applyFilter() {
  const query = filter.value.trim().toLocaleLowerCase();
  let visible = 0;
  for (const node of filterables) {
    const match = !query || node.dataset.search.includes(query);
    node.hidden = !match;
    if (match && node.hasAttribute("data-catalog-row")) visible += 1;
  }
  if (!catalogRows.length) {
    visible = filterables.filter((node) => !node.hidden).length;
  }
  if (filterStatus) filterStatus.textContent = query ? `${visible} ${visible === 1 ? "category" : "categories"}` : "";
  if (filterEmpty) filterEmpty.hidden = !query || visible > 0;
  if (catalogHead) catalogHead.hidden = Boolean(query) && visible === 0;
}

filter?.addEventListener("input", applyFilter);

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
