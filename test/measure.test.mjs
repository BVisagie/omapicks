import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/_middleware.js";
import worker from "../workers/index.mjs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  buildPageView,
  classifyRequest,
  dailyVisitorId,
  FILTERED_SAMPLE_RATE,
  MEASUREMENT_VERSION,
  normalizePath,
  optedOut,
  recordPageView,
  utcDay
} from "../functions/measure.mjs";
import isbotPatterns, { ISBOT_PATTERNS_SHA256 } from "../functions/vendor/isbot-patterns.mjs";

const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const BROWSER_HEADERS = {
  "user-agent": CHROME,
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "accept-language": "en-GB,en;q=0.9",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

function htmlResponse(status = 200) {
  return new Response("<!doctype html><html><body>ok</body></html>", {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function pageRequest(path, headers = {}, cf) {
  const request = new Request(`https://omapicks.com${path}`, {
    method: headers.method ?? "GET",
    headers: {
      ...BROWSER_HEADERS,
      "cf-connecting-ip": "203.0.113.10",
      ...headers
    }
  });
  if (cf) Object.defineProperty(request, "cf", { value: cf });
  return request;
}

// Agents the original keyword filter counted as people, as each tool sends them.
const AUTOMATED_AGENTS = {
  "Meta fetcher": "meta-externalfetcher/1.1",
  "Anthropic (legacy)": "anthropic-ai",
  "Claude-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  "Perplexity-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
  "cohere-ai": "cohere-ai",
  "WhatsApp preview": "WhatsApp/2.23.20.0 A",
  "Signal preview": "Signal-Android/7.0",
  "Google-InspectionTool": "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)",
  Lighthouse:
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
  "Node fetch": "node",
  axios: "axios/1.7.2",
  okhttp: "okhttp/4.12.0",
  "Python urllib": "Python-urllib/3.12",
  aiohttp: "Python/3.12 aiohttp/3.9.5",
  httpx: "python-httpx/0.27.0",
  Java: "Java/17.0.2",
  "libwww-perl": "libwww-perl/6.72",
  Postman: "PostmanRuntime/7.39.0",
  Feedly: "Feedly/1.0 (+http://www.feedly.com/fetcher.html; 5 subscribers)",
  "Mastodon preview": "http.rb/5.1.1 (Mastodon/4.2.0; +https://mastodon.social/)",
  Googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "OAI-SearchBot": "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)"
};

const BROWSERS = {
  "Chrome on Linux": CHROME,
  "Firefox on Linux": "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
  "Safari on iPhone":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  "Edge on Windows":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  "Chrome on Android":
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"
};

test("the vendored crawler list is byte-for-byte the pinned upstream file", async () => {
  const text = await readFile(new URL("../functions/vendor/isbot-patterns.mjs", import.meta.url), "utf8");
  const begin = "/* BEGIN isbot src/patterns.json */\n";
  const end = "/* END isbot src/patterns.json */";
  assert.ok(text.includes(begin) && text.includes(end));
  const body = text.slice(text.indexOf(begin) + begin.length, text.indexOf(end));
  assert.equal(createHash("sha256").update(body).digest("hex"), ISBOT_PATTERNS_SHA256);
  assert.deepEqual(JSON.parse(body), isbotPatterns);
});

test("automated agents are classified as crawlers whatever headers they send", () => {
  for (const [name, userAgent] of Object.entries(AUTOMATED_AGENTS)) {
    assert.equal(
      classifyRequest(new Headers({ ...BROWSER_HEADERS, "user-agent": userAgent })),
      "crawler-list",
      name
    );
    assert.equal(classifyRequest(new Headers({ "user-agent": userAgent, accept: "*/*" })), "crawler-list", name);
  }
});

test("current browsers loading a page count as people", () => {
  for (const [name, userAgent] of Object.entries(BROWSERS)) {
    assert.equal(classifyRequest(new Headers({ ...BROWSER_HEADERS, "user-agent": userAgent })), "human", name);
  }
});

test("a browser user-agent without page-load headers is not counted as a person", () => {
  const spoofed = { "user-agent": CHROME, accept: "*/*" };
  assert.equal(classifyRequest(new Headers(spoofed)), "no-browser-headers");
  assert.equal(classifyRequest(new Headers({ ...BROWSER_HEADERS, "accept-language": "" })), "no-browser-headers");
  assert.equal(classifyRequest(new Headers({ ...BROWSER_HEADERS, "sec-fetch-dest": "iframe" })), "no-browser-headers");
  assert.equal(classifyRequest(new Headers({ ...BROWSER_HEADERS, "user-agent": "" })), "no-browser-headers");
});

test("prefetches and cloud networks are separated from people", () => {
  assert.equal(classifyRequest(new Headers({ ...BROWSER_HEADERS, "sec-purpose": "prefetch" })), "prefetch");
  assert.equal(classifyRequest(new Headers({ ...BROWSER_HEADERS, "sec-purpose": "prefetch;prerender" })), "prefetch");
  assert.equal(classifyRequest(new Headers({ ...BROWSER_HEADERS, purpose: "prefetch" })), "prefetch");
  assert.equal(classifyRequest(new Headers(BROWSER_HEADERS), { asn: 16509 }), "cloud-network");
  assert.equal(classifyRequest(new Headers(BROWSER_HEADERS), { asn: 24940 }), "cloud-network");
  // Cloudflare WARP and consumer VPN networks stay counted as people.
  assert.equal(classifyRequest(new Headers(BROWSER_HEADERS), { asn: 13335 }), "human");
  assert.equal(classifyRequest(new Headers(BROWSER_HEADERS), { asn: 9009 }), "human");
});

test("HTML category paths are normalized and unknown paths are dropped", () => {
  assert.equal(normalizePath("/picks/network"), "/picks/network/");
  assert.equal(normalizePath("/picks/network/"), "/picks/network/");
  assert.equal(normalizePath("/"), "/");
  assert.equal(normalizePath("/privacy/"), "/privacy/");
  assert.equal(normalizePath("/feed/"), "/feed/");
  assert.equal(normalizePath("/feed.xml"), null);
  assert.equal(normalizePath("/assets/styles.css"), null);
  assert.equal(normalizePath("/picks/../network/"), null);
  assert.equal(normalizePath("/picks/NETWORK/"), null);
});

test("opt-out headers are honored", () => {
  assert.equal(optedOut(new Headers({ "sec-gpc": "1" })), true);
  assert.equal(optedOut(new Headers({ dnt: "1" })), true);
  assert.equal(optedOut(new Headers({ "user-agent": "Mozilla/5.0" })), false);
});

test("daily visitor hashes rotate with the UTC day and never include the IP", async () => {
  const monday = await dailyVisitorId("salt", "2026-09-01", "203.0.113.10");
  const tuesday = await dailyVisitorId("salt", "2026-09-02", "203.0.113.10");
  assert.equal(monday.length, 32);
  assert.notEqual(monday, tuesday);
  assert.ok(!monday.includes("203"));
  assert.equal(utcDay(new Date("2026-09-01T23:15:00Z")), "2026-09-01");
});

test("page views keep only path, day, a daily hash, and the traffic class", async () => {
  const point = await buildPageView({
    request: pageRequest("/picks/network/?ref=home", {}, { asn: 7922, country: "US", city: "Boston" }),
    response: htmlResponse(),
    salt: "secret-salt",
    now: new Date("2026-09-01T12:00:00Z")
  });
  assert.deepEqual(point.indexes, ["2026-09-01"]);
  assert.equal(point.blobs[0], "/picks/network/");
  assert.equal(point.blobs[1].length, 32);
  assert.deepEqual(point.blobs.slice(2), ["human", MEASUREMENT_VERSION]);
  assert.deepEqual(point.doubles, [1]);
  const stored = JSON.stringify(point);
  for (const leaked of ["203.0.113.10", "ref=home", "7922", "Boston", "Chrome", "en-GB"]) {
    assert.ok(!stored.includes(leaked), leaked);
  }
});

test("filtered requests are sampled, weighted, and carry no visitor identifier", async () => {
  const kept = await buildPageView({
    request: pageRequest("/picks/network/", { "user-agent": AUTOMATED_AGENTS.Googlebot }),
    response: htmlResponse(),
    salt: "secret-salt",
    now: new Date("2026-09-01T12:00:00Z"),
    random: () => 0
  });
  assert.deepEqual(kept, {
    indexes: ["2026-09-01"],
    blobs: ["/picks/network/", "", "crawler-list", MEASUREMENT_VERSION],
    doubles: [FILTERED_SAMPLE_RATE]
  });
  const skipped = await buildPageView({
    request: pageRequest("/picks/network/", { "user-agent": AUTOMATED_AGENTS.Googlebot }),
    response: htmlResponse(),
    salt: "secret-salt",
    random: () => 0.5
  });
  assert.equal(skipped, null);
  const cloud = await buildPageView({
    request: pageRequest("/", {}, { asn: 14061 }),
    response: htmlResponse(),
    salt: "secret-salt",
    random: () => 0.05
  });
  assert.deepEqual(cloud.blobs.slice(1, 3), ["", "cloud-network"]);
});

test("opted-out, failed and non-HTML pages and a missing salt are never recorded", async () => {
  for (const headers of [{ "sec-gpc": "1" }, { dnt: "1" }]) {
    assert.equal(
      await buildPageView({
        request: pageRequest("/picks/network/", headers),
        response: htmlResponse(),
        salt: "secret-salt",
        random: () => 0
      }),
      null
    );
  }
  assert.equal(
    await buildPageView({
      request: pageRequest("/picks/network/", { "user-agent": AUTOMATED_AGENTS.Googlebot, "sec-gpc": "1" }),
      response: htmlResponse(),
      salt: "secret-salt",
      random: () => 0
    }),
    null
  );
  assert.equal(
    await buildPageView({
      request: pageRequest("/picks/network/"),
      response: htmlResponse(404),
      salt: "secret-salt"
    }),
    null
  );
  assert.equal(
    await buildPageView({
      request: pageRequest("/picks/network/"),
      response: htmlResponse(),
      salt: ""
    }),
    null
  );
});

test("measurement fails open when the analytics binding throws", async () => {
  const response = htmlResponse();
  const context = {
    request: pageRequest("/picks/network/"),
    env: {
      ANALYTICS_SALT: "secret-salt",
      ANALYTICS: {
        writeDataPoint() {
          throw new Error("unavailable");
        }
      }
    },
    async next() {
      return response;
    },
    waitUntil(promise) {
      this.pending = promise;
    }
  };
  const result = await onRequest(context);
  assert.equal(result.status, 200);
  await context.pending;
});

test("pages without a binding still render", async () => {
  const points = [];
  await recordPageView(
    {
      request: pageRequest("/picks/network/"),
      env: {}
    },
    htmlResponse()
  );
  assert.deepEqual(points, []);
});

test("the Worker redirects HTTP and www requests to canonical HTTPS", async () => {
  let assetRequests = 0;
  const env = {
    ASSETS: {
      fetch() {
        assetRequests += 1;
        return htmlResponse();
      }
    }
  };

  for (const [source, destination] of [
    ["http://omapicks.com/picks/network/?ref=home", "https://omapicks.com/picks/network/?ref=home"],
    ["https://www.omapicks.com/methodology/", "https://omapicks.com/methodology/"],
    ["http://www.omapicks.com/changelog/", "https://omapicks.com/changelog/"]
  ]) {
    const response = await worker.fetch(new Request(source), env, {});
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), destination);
  }

  assert.equal(assetRequests, 0);
});

test("the Worker serves assets and records HTML page views", async () => {
  const points = [];
  const env = {
    ANALYTICS_SALT: "secret-salt",
    ANALYTICS: {
      writeDataPoint(point) {
        points.push(point);
      }
    },
    ASSETS: {
      fetch() {
        return htmlResponse();
      }
    }
  };
  const ctx = {
    waitUntil(promise) {
      this.pending = promise;
    }
  };
  const result = await worker.fetch(pageRequest("/picks/network/"), env, ctx);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("strict-transport-security"), "max-age=300");
  await ctx.pending;
  assert.equal(points.length, 1);
  assert.equal(points[0].blobs[0], "/picks/network/");
});
