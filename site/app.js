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
    themeButton.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
  }
}

setTheme(storedTheme() || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));

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
const sections = [...document.querySelectorAll("[data-pick-section]")];
const filterStatus = document.querySelector("[data-filter-status]");

function applyFilter() {
  const query = filter.value.trim().toLocaleLowerCase();
  let visible = 0;
  for (const section of sections) {
    const match = !query || section.dataset.search.includes(query);
    section.hidden = !match;
    if (match) visible += 1;
  }
  if (filterStatus) filterStatus.textContent = `${visible} ${visible === 1 ? "type" : "types"} shown`;
}

filter?.addEventListener("input", applyFilter);
if (filter) applyFilter();

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
    const original = button.textContent;
    try {
      await copyText(command);
      button.textContent = "Copied";
      button.setAttribute("aria-label", "Install command copied");
    } catch {
      button.textContent = "Select";
      button.closest(".command-row")?.querySelector("code")?.focus();
    }
    window.setTimeout(() => {
      button.textContent = original;
      button.removeAttribute("aria-label");
    }, 1800);
  });
}

const hero = document.querySelector("[data-hero-pick]");
if (hero && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  try {
    const items = JSON.parse(hero.dataset.items);
    let index = 0;
    if (Array.isArray(items) && items.length > 1) {
      window.setInterval(() => {
        index = (index + 1) % items.length;
        const item = items[index];
        const link = document.createElement("a");
        link.href = item.href;
        link.textContent = item.name;
        hero.replaceChildren(`The best ${item.type} is `, link, ".");
      }, 4800);
    }
  } catch {
    // The prerendered first pick remains visible if metadata is malformed.
  }
}
