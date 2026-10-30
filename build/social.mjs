import { Resvg } from "@resvg/resvg-js";
import { fileURLToPath } from "node:url";
import { methodologyFor } from "./methodology.mjs";

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

// Site theme colours, mirrored from the dark tokens in site/styles.css (see PALETTE in render.mjs).
export const SOCIAL_PALETTE = Object.freeze({ bg: "#0b0d14", ink: "#c0caf5", muted: "#8a93b8", accent: "#8bd5ca", violet: "#7aa2f7", line: "#c0caf5" });

export function socialSvg(type, week, { methodologyVersion } = {}) {
  const reviewed = methodologyFor(methodologyVersion).eligibility.repositoryEvidence === true;
  const c = SOCIAL_PALETTE;
  const text = (value, x, y, size, color) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${escape(value)}</text>`;
  const title = lines(type.name, 26, 2);
  const pick = (label, name, y) => text(label, 66, y, 18, c.accent) +
    text(lines(name, 56, 1)[0], 66, y + 38, 29, c.ink);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <radialGradient id="glow-a" gradientUnits="userSpaceOnUse" cx="140" cy="40" r="640">
        <stop offset="0" stop-color="${c.accent}" stop-opacity="0.26"/>
        <stop offset="1" stop-color="${c.accent}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="glow-b" gradientUnits="userSpaceOnUse" cx="1120" cy="640" r="620">
        <stop offset="0" stop-color="${c.violet}" stop-opacity="0.24"/>
        <stop offset="1" stop-color="${c.violet}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="630" fill="${c.bg}"/>
    <rect width="1200" height="630" fill="url(#glow-a)"/>
    <rect width="1200" height="630" fill="url(#glow-b)"/>
    <rect x="32" y="32" width="1136" height="566" rx="20" fill="none" stroke="${c.line}" stroke-opacity="0.18" stroke-width="2"/>
    <g font-family="Liberation Mono">
      ${text("OmaPicks", 66, 91, 32, c.accent)}
      ${text(week ?? "Weekly picks", 944, 88, 22, c.muted)}
      <path d="M66 119H1134" stroke="${c.line}" stroke-opacity="0.18"/>
      ${title.map((line, index) => text(line, 66, 194 + index * 68, 62, c.ink)).join("")}
      ${pick(reviewed ? "01 LEADING REVIEWED OPTION" : "01 CHAMPION", type.winner?.name ?? (reviewed ? "No reviewed option yet" : "No champion yet"), 334)}
      ${pick(reviewed ? "02 ANOTHER REVIEWED OPTION" : "02 RUNNER-UP", type.runnerUp?.name ?? (reviewed ? "No additional reviewed option yet" : "No runner-up yet"), 440)}
      <path d="M66 518H1134" stroke="${c.line}" stroke-opacity="0.18"/>
      ${text(reviewed ? "Reviewed Omarchy plugin shortlists" : "Independent weekly Omarchy plugin rankings", 66, 564, 22, c.muted)}
      ${text("omapicks.com", 940, 564, 22, c.accent)}
    </g>
  </svg>`;
}

export function renderSocialImage(type, week, options) {
  return new Resvg(socialSvg(type, week, options), {
    font: { fontFiles: [fontFile], loadSystemFonts: false, defaultFontFamily: "Liberation Mono" }
  }).render().asPng();
}
