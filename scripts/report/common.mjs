import { migrationsForSnapshot } from "../../build/category-migrations.mjs";

export const ORIGIN = "https://omapicks.com";
export const ALLOWED_DAYS = Object.freeze([7, 28, 90]);
// Analytics Engine keeps three months; Search Console keeps sixteen.
export const TRAFFIC_RETENTION_DAYS = 90;
export const SEARCH_LAG_DAYS = 3;
export const FIXED_PAGES = Object.freeze(["/", "/methodology/", "/changelog/", "/feed/", "/privacy/"]);
export const OTHER_PATH = "other";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// A section-level failure whose message is safe to publish: never a response body,
// header, identifier or credential.
export class ReportSectionError extends Error {}

export function parseDays(value) {
  const days = Number(value ?? 28);
  if (!ALLOWED_DAYS.includes(days)) {
    throw new ReportSectionError(`Report length must be one of ${ALLOWED_DAYS.join(", ")} days.`);
  }
  return days;
}

export function isDay(value) {
  return typeof value === "string" && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function dayString(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return dayString(date);
}

export function daysBetween(start, end) {
  const days = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

// Weekday 0 is Monday.
export function weekday(day) {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

// Complete UTC days ending `lagDays` before today, plus the same-length previous period when
// the source still holds it.
export function reportPeriods(days, now = new Date(), { lagDays = 1, retentionDays = Infinity } = {}) {
  const end = addDays(dayString(now), -lagDays);
  const start = addDays(end, -(days - 1));
  const current = { start, end, days };
  const reachesBack = days * 2 + lagDays <= retentionDays;
  const previous = reachesBack ? { start: addDays(start, -days), end: addDays(start, -1), days } : null;
  return { current, previous };
}

export function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

export function change(current, previous) {
  if (previous === null || previous === undefined || !(previous > 0)) return null;
  return (current - previous) / previous;
}

export function categoryPath(id) {
  return `/picks/${id}/`;
}

// The only page paths a report may name: the fixed pages, current categories and retired
// category pages still in the sitemap. Anything else becomes "other".
export function knownPages(rankings) {
  const current = rankings.types.map((type) => ({ path: categoryPath(type.id), name: type.name, kind: "category" }));
  const currentIds = new Set(rankings.types.map((type) => type.id));
  const retired = migrationsForSnapshot(rankings)
    .flatMap((migration) => migration.changes)
    .filter((entry) => entry.retired && !currentIds.has(entry.from.id))
    .map((entry) => ({ path: categoryPath(entry.from.id), name: entry.from.name, kind: "retired" }));
  const fixedNames = { "/": "Home", "/methodology/": "Methodology", "/changelog/": "Changelog", "/feed/": "RSS", "/privacy/": "Privacy" };
  const pages = [...FIXED_PAGES.map((path) => ({ path, name: fixedNames[path], kind: "page" })), ...current, ...retired];
  return new Map(pages.map((page) => [page.path, page]));
}

export function sanitizePath(value, pages) {
  return typeof value === "string" && pages.has(value) ? value : OTHER_PATH;
}

export function pageFromUrl(value, pages) {
  if (typeof value !== "string") return OTHER_PATH;
  let url;
  try {
    url = new URL(value);
  } catch {
    return OTHER_PATH;
  }
  if (url.origin !== ORIGIN && url.origin !== "https://www.omapicks.com") return OTHER_PATH;
  return sanitizePath(url.pathname, pages);
}

// Free text from outside (search queries, Google status labels) is trimmed, stripped of control
// characters and bounded. It is always HTML-escaped when rendered.
export function boundedText(value, maximum = 100) {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > maximum ? `${clean.slice(0, maximum - 1)}…` : clean;
}

export function sectionError(error, fallback) {
  return { status: "error", error: error instanceof ReportSectionError ? error.message : fallback };
}
