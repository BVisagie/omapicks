const encoder = new TextEncoder();
const HTML_PATH = new Set(["/", "/methodology/", "/changelog/", "/privacy/"]);
const PICKS_PATH = /^\/picks\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/;
const BOT_UA =
  /bot|crawler|spider|crawling|preview|headless|wget|curl|slurp|facebookexternal|pingdom|monitor|python-requests|go-http-client|httpclient|scrapy|semrush|ahrefs|bingpreview|bytespider/i;

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
  return BOT_UA.test(userAgent);
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

export async function buildPageView({ request, response, salt, now = new Date() }) {
  if (!salt || !request || request.method !== "GET") return null;
  if (optedOut(request.headers) || isAutomatedClient(request.headers.get("user-agent"))) return null;
  if (!shouldRecordResponse(response)) return null;
  const path = normalizePath(new URL(request.url).pathname);
  const ip = clientIp(request.headers);
  if (!path || !ip) return null;
  const day = utcDay(now);
  return {
    indexes: [day],
    blobs: [path, await dailyVisitorId(salt, day, ip)],
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
