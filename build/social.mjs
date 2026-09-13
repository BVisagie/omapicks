import { Resvg } from "@resvg/resvg-js";
import { fileURLToPath } from "node:url";

const fontFile = fileURLToPath(new URL("./fonts/LiberationMono-Regular.ttf", import.meta.url));
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");

function lines(value, width, limit) {
  const words = String(value).split(/\s+/).filter(Boolean);
  const result = [""];
  for (const word of words) {
    // Long unbroken plugin names should not run outside the image either.
    for (const part of word.match(new RegExp(`.{1,${width}}`, "gu")) ?? []) {
      const last = result.length - 1;
      if ((result[last] ? `${result[last]} ${part}` : part).length <= width) {
        result[last] += `${result[last] ? " " : ""}${part}`;
      } else result.push(part);
    }
  }
  if (result.length > limit) result[limit - 1] = `${result[limit - 1].slice(0, width - 1)}…`;
  return result.slice(0, limit);
}

export function socialSvg(type, week) {
  const text = (value, x, y, size, color) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${escape(value)}</text>`;
  const title = lines(type.name, 26, 2);
  const pick = (label, name, y) => text(label, 66, y, 18, "#8bd5ca") +
    text(lines(name, 56, 1)[0], 66, y + 38, 29, "#c0caf5");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#1a1b26"/>
    <rect x="32" y="32" width="1136" height="566" fill="none" stroke="#414868" stroke-width="2"/>
    <g font-family="Liberation Mono">
      ${text("OmaPicks", 66, 91, 32, "#8bd5ca")}
      ${text(week ?? "Weekly picks", 944, 88, 22, "#a4abc5")}
      <path d="M66 119H1134" stroke="#414868"/>
      ${title.map((line, index) => text(line, 66, 194 + index * 68, 62, "#c0caf5")).join("")}
      ${pick("01 CHAMPION", type.winner?.name ?? "No champion yet", 334)}
      ${pick("02 RUNNER-UP", type.runnerUp?.name ?? "No runner-up yet", 440)}
      <path d="M66 518H1134" stroke="#414868"/>
      ${text("Independent weekly Omarchy plugin rankings", 66, 564, 22, "#a4abc5")}
      ${text("omapicks.com", 940, 564, 22, "#8bd5ca")}
    </g>
  </svg>`;
}

export function renderSocialImage(type, week) {
  return new Resvg(socialSvg(type, week), {
    font: { fontFiles: [fontFile], loadSystemFonts: false, defaultFontFamily: "Liberation Mono" }
  }).render().asPng();
}
