import { recordPageView } from "../functions/measure.mjs";

const CANONICAL_HOST = "omapicks.com";
const HSTS = "max-age=300";

function canonicalRedirect(request) {
  const url = new URL(request.url);
  const isApexHttp = url.hostname === CANONICAL_HOST && url.protocol === "http:";
  const isWww = url.hostname === `www.${CANONICAL_HOST}`;
  if (!isApexHttp && !isWww) return null;

  url.protocol = "https:";
  url.hostname = CANONICAL_HOST;
  url.port = "";
  return Response.redirect(url, 308);
}

export default {
  async fetch(request, env, ctx) {
    const redirect = canonicalRedirect(request);
    if (redirect) return redirect;

    const response = await env.ASSETS.fetch(request);
    const done = recordPageView({ request, env }, response);
    if (typeof ctx?.waitUntil === "function") ctx.waitUntil(done);
    const securedResponse = new Response(response.body, response);
    securedResponse.headers.set("Strict-Transport-Security", HSTS);
    return securedResponse;
  }
};
