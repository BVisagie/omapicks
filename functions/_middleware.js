import { recordPageView } from "./measure.mjs";

export async function onRequest(context) {
  const response = await context.next();
  const done = recordPageView(context, response);
  if (typeof context.waitUntil === "function") context.waitUntil(done);
  return response;
}
