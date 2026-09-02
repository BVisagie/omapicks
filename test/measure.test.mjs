import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/_middleware.js";
import worker from "../workers/index.mjs";
import {
  buildPageView,
  dailyVisitorId,
  normalizePath,
  optedOut,
  recordPageView,
  utcDay
} from "../functions/measure.mjs";

function htmlResponse(status = 200) {
  return new Response("<!doctype html><html><body>ok</body></html>", {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function pageRequest(path, headers = {}) {
  return new Request(`https://omapicks.com${path}`, {
    method: headers.method ?? "GET",
    headers: {
      "user-agent": "Mozilla/5.0",
      "cf-connecting-ip": "203.0.113.10",
      ...headers
    }
  });
}

test("HTML category paths are normalized and unknown paths are dropped", () => {
  assert.equal(normalizePath("/picks/network"), "/picks/network/");
  assert.equal(normalizePath("/picks/network/"), "/picks/network/");
  assert.equal(normalizePath("/"), "/");
  assert.equal(normalizePath("/privacy/"), "/privacy/");
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

test("page views keep only path, day, and a daily hash", async () => {
  const point = await buildPageView({
    request: pageRequest("/picks/network/?ref=home"),
    response: htmlResponse(),
    salt: "secret-salt",
    now: new Date("2026-09-01T12:00:00Z")
  });
  assert.deepEqual(point.indexes, ["2026-09-01"]);
  assert.equal(point.blobs[0], "/picks/network/");
  assert.equal(point.blobs[1].length, 32);
  assert.deepEqual(point.doubles, [1]);
  assert.ok(!JSON.stringify(point).includes("203.0.113.10"));
  assert.ok(!JSON.stringify(point).includes("ref=home"));
});

test("crawlers, failed pages, and missing salt are not recorded", async () => {
  assert.equal(
    await buildPageView({
      request: pageRequest("/picks/network/", { "user-agent": "Googlebot/2.1" }),
      response: htmlResponse(),
      salt: "secret-salt"
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
