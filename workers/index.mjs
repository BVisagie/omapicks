import { recordPageView } from "../functions/measure.mjs";

export default {
  async fetch(request, env, ctx) {
    const response = await env.ASSETS.fetch(request);
    const done = recordPageView({ request, env }, response);
    if (typeof ctx?.waitUntil === "function") ctx.waitUntil(done);
    return response;
  }
};
