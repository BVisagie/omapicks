import { isCloudNetwork } from "./cloud-networks.mjs";
import isbotPatterns from "./vendor/isbot-patterns.mjs";

const encoder = new TextEncoder();
const HTML_PATH = new Set(["/", "/methodology/", "/changelog/", "/feed/", "/privacy/"]);
const PICKS_PATH = /^\/picks\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/;
// Terms from the original filter, kept so the maintained list can only add coverage.
const LOCAL_CRAWLER_TERMS =
  "bot|crawler|spider|crawling|preview|headless|wget|curl|slurp|facebookexternal|pingdom|monitor|python-requests|go-http-client|httpclient|scrapy|semrush|ahrefs|bingpreview|bytespider";
const CRAWLER_PATTERN = new RegExp([...isbotPatterns, LOCAL_CRAWLER_TERMS].join("|"), "i");

// Version 2 records a traffic class for every event; version 1 rows have no class.
export const MEASUREMENT_VERSION = "2";
export const HUMAN = "human";
export const FILTER_REASONS = Object.freeze(["crawler-list", "no-browser-headers", "prefetch", "cloud-network"]);
// One in ten filtered requests is recorded and weighted back up, so crawler storms stay cheap.
export const FILTERED_SAMPLE_RATE = 10;

export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function normalizePath(pathname) {
  if (typeof pathname !== "string" || pathname.includes("\\") || pathname.includes("..")) return null;
  let path = pathname.trim();
  if (!path.startsWith("/")) return null;
  path = path.replace(/\/{2,}/g, "/");
  if (path !== "/" && !path.endsWith("/")) path += "/";
  if (HTML_PATH.has(path) || PICKS_PATH.test(path)) return path;
  return null;
}

export function optedOut(headers) {
  const gpc = String(headers.get("sec-gpc") ?? "").trim();
  const dnt = String(headers.get("dnt") ?? "").trim();
  return gpc === "1" || dnt === "1";
}

export function isAutomatedClient(userAgent) {
  if (typeof userAgent !== "string" || userAgent.trim().length === 0) return true;
  return CRAWLER_PATTERN.test(userAgent);
}

function headerValue(headers, name) {
  return String(headers.get(name) ?? "")
    .trim()
    .toLowerCase();
}

export function isPrefetch(headers) {
  return (
    headerValue(headers, "sec-purpose").includes("prefetch") ||
    headerValue(headers, "purpose") === "prefetch" ||
    headerValue(headers, "x-moz") === "prefetch" ||
    headerValue(headers, "x-purpose") === "preview"
  );
}

// Current Chrome, Edge, Firefox and Safari (16.4+) send these on every top-level page load.
export function isBrowserNavigation(headers) {
  return (
    headerValue(headers, "sec-fetch-dest") === "document" &&
    headerValue(headers, "sec-fetch-mode") === "navigate" &&
    headerValue(headers, "accept-language").length > 0
  );
}

export function classifyRequest(headers, cf = {}) {
  const userAgent = headers.get("user-agent");
  if (typeof userAgent !== "string" || userAgent.trim().length === 0) return "no-browser-headers";
  if (CRAWLER_PATTERN.test(userAgent)) return "crawler-list";
  if (isPrefetch(headers)) return "prefetch";
  if (!isBrowserNavigation(headers)) return "no-browser-headers";
  if (isCloudNetwork(cf?.asn)) return "cloud-network";
  return HUMAN;
}

export function clientIp(headers) {
  const forwarded = String(headers.get("cf-connecting-ip") || headers.get("x-forwarded-for") || "")
    .split(",")[0]
    .trim();
  return forwarded || null;
}

export function shouldRecordResponse(response) {
  if (!response || response.status !== 200) return false;
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  return type.includes("text/html");
}

export async function dailyVisitorId(salt, day, ip) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(salt), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign"
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${day}|${ip}`));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

// Event layout: index1 day; blob1 path; blob2 daily visitor id (browser visits only);
// blob3 traffic class; blob4 measurement version; double1 weight.
export async function buildPageView({ request, response, salt, now = new Date(), random = Math.random }) {
  if (!salt || !request || request.method !== "GET") return null;
  if (optedOut(request.headers)) return null;
  if (!shouldRecordResponse(response)) return null;
  const path = normalizePath(new URL(request.url).pathname);
  if (!path) return null;
  const day = utcDay(now);
  const trafficClass = classifyRequest(request.headers, request.cf);
  if (trafficClass !== HUMAN) {
    if (random() >= 1 / FILTERED_SAMPLE_RATE) return null;
    return {
      indexes: [day],
      blobs: [path, "", trafficClass, MEASUREMENT_VERSION],
      doubles: [FILTERED_SAMPLE_RATE]
    };
  }
  const ip = clientIp(request.headers);
  if (!ip) return null;
  return {
    indexes: [day],
    blobs: [path, await dailyVisitorId(salt, day, ip), HUMAN, MEASUREMENT_VERSION],
    doubles: [1]
  };
}

export async function recordPageView(context, response) {
  try {
    const analytics = context.env?.ANALYTICS;
    if (!analytics || typeof analytics.writeDataPoint !== "function") return;
    const point = await buildPageView({
      request: context.request,
      response,
      salt: context.env?.ANALYTICS_SALT
    });
    if (point) analytics.writeDataPoint(point);
  } catch {
    // Measurement must never take the site down.
  }
}
