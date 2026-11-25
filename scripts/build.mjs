// Draws every README card and writes README.md.
//
//   node scripts/build.mjs                       fetch live GitHub data (what the nightly Action runs)
//   node scripts/build.mjs --from-file data.json render from saved data (testing)
//
// Every card comes in four versions: dark, light, phone-dark, phone-light. Fonts are embedded,
// so the cards look the same everywhere. No npm packages, no third-party stats services.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fetchGitHub } from "./fetch.mjs";

const root = new URL("../", import.meta.url);
const read = async (p) => readFile(new URL(p, root), "utf8");
const profile = JSON.parse(await read("profile.json"));
const icons = JSON.parse(await read("data/icons.json"));
const metrics = JSON.parse(await read("data/metrics.json"));
const FONT_FILES = {
  display: "bricolage-grotesque-800", body: "bricolage-grotesque-500", mono: "jetbrains-mono-400", monob: "jetbrains-mono-700",
};
const fontData = {};
for (const [k, f] of Object.entries(FONT_FILES))
  fontData[k] = (await readFile(new URL(`data/fonts/${f}.woff2`, root))).toString("base64");

// ---------------------------------------------------------------- design tokens
const THEMES = {
  dark: {
    name: "dark", card: "#141922", card2: "#1b212c", grid: "#1f2633", line: "#2a3242", fg: "#e8eaf0", muted: "#a7aebd", faint: "#858c9c",
    on: "#0d1117", term: "#0b0e14",
    blue: "#7c9bff", green: "#4cc38a", violet: "#b39cf5", amber: "#e8b45e", rose: "#f08aa6",
    tint: 0.13, stroke: 0.5, heat: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
  },
  light: {
    name: "light", card: "#ffffff", card2: "#f2f4f8", grid: "#eef1f5", line: "#d9dee6", fg: "#1c2128", muted: "#4f5866", faint: "#6c7583",
    on: "#ffffff", term: "#f7f8fa",
    blue: "#3d5bd9", green: "#1d7f4e", violet: "#7048e8", amber: "#a86b0c", rose: "#c22a5c",
    tint: 0.09, stroke: 0.45, heat: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const human = (s) => { const [y, m, d] = s.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const fmt = (n) => Number(n).toLocaleString("en-US");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const lastYearTotal = (g) => profile.reportedContributionsLastYear ?? g.last.total;

// ---------------------------------------------------------------- svg kit
class Doc {
  constructor(T) { this.T = T; this.fonts = new Set(); this.parts = []; this.defs = []; }
  width(s, f, size) {
    const m = metrics[f];
    let u = 0;
    for (const ch of String(s)) u += m.w[ch] ?? m.upm * 0.6;
    return (u / m.upm) * size;
  }
  text(x, y, s, { f = "body", size = 14, fill = this.T.fg, anchor = "start", extra = "" } = {}) {
    this.fonts.add(f);
    this.parts.push(`<text x="${r(x)}" y="${r(y)}" font-family="sa-${f}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" ${extra}>${esc(s)}</text>`);
  }
  spans(x, y, list, { anchor = "start" } = {}) { // [[text, {f,size,fill,dx}], ...]
    let out = `<text x="${r(x)}" y="${r(y)}" text-anchor="${anchor}">`;
    for (const [s, o] of list) {
      this.fonts.add(o.f);
      out += `<tspan font-family="sa-${o.f}" font-size="${o.size}" fill="${o.fill ?? this.T.fg}"${o.dx ? ` dx="${o.dx}"` : ""}>${esc(s)}</tspan>`;
    }
    this.parts.push(out + "</text>");
  }
  raw(s) { this.parts.push(s); }
  wrap(s, f, size, maxW) {
    const out = []; let line = "";
    for (const word of String(s).split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (this.width(test, f, size) > maxW && line) { out.push(line); line = word; } else line = test;
    }
    if (line) out.push(line);
    return out;
  }
  pill(x, y, label, color, { f = "mono", size = 12, h = 26, solid = false, pad = 11 } = {}) {
    const w = this.width(label, f, size) + pad * 2;
    const T = this.T;
    this.raw(`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${h}" rx="${h / 2}" fill="${color}" fill-opacity="${solid ? 1 : T.tint}" stroke="${color}" stroke-opacity="${solid ? 0 : T.stroke}"/>`);
    this.text(x + w / 2, y + h / 2 + size * 0.36, label, { f, size, fill: solid ? T.on : color, anchor: "middle" });
    return w;
  }
  frame(w, h, { rx = 18, fill = this.T.card, stroke = this.T.line } = {}) {
    this.raw(`<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${rx}" fill="${fill}" stroke="${stroke}"/>`);
  }
  render(w, h, label) {
    const faces = [...this.fonts].map((f) => `@font-face{font-family:"sa-${f}";src:url(data:font/woff2;base64,${fontData[f]}) format("woff2")}`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
<style>${faces}</style>${this.defs.length ? `<defs>${this.defs.join("")}</defs>` : ""}
${this.parts.join("\n")}
</svg>\n`;
  }
}
const r = (n) => Math.round(n * 10) / 10;
const tintOf = (T, name) => T[name] ?? T.blue;
function brand(doc, slug, x, y, size, fill) {
  const i = slug && icons[slug];
  if (!i) return false;
  doc.raw(`<path transform="translate(${r(x)} ${r(y)}) scale(${size / 24})" d="${i.path}" fill="${fill}"/>`);
  return true;
}
function readable(T, hex) {
  const [R, G, B] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  if (T.name === "dark" && L < 0.3) return T.muted;
  if (T.name === "light" && L > 0.7) return T.muted;
  return `#${hex}`;
}
function blueprint(doc, w, h, id) {
  const T = doc.T;
  doc.defs.push(`<pattern id="${id}" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="${T.grid}" stroke-width="1"/></pattern>
<radialGradient id="${id}f" cx="0.15" cy="0.25" r="0.95"><stop offset="0" stop-color="${T.card}" stop-opacity="0"/><stop offset="0.75" stop-color="${T.card}" stop-opacity="1"/></radialGradient>
<clipPath id="${id}c"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="17"/></clipPath>`);
  doc.raw(`<g clip-path="url(#${id}c)"><rect width="${w}" height="${h}" fill="url(#${id})"/><rect width="${w}" height="${h}" fill="url(#${id}f)"/></g>`);
}

// ---------------------------------------------------------------- small glyphs
const GLYPH = {
  portal: (c) => `<rect x="10" y="12" width="32" height="26" rx="4" fill="none" stroke="${c}" stroke-width="2.6"/><line x1="10" y1="19.5" x2="42" y2="19.5" stroke="${c}" stroke-width="2.6"/><circle cx="18" cy="29" r="2.6" fill="${c}"/><line x1="24" y1="29" x2="36" y2="29" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`,
  dashboard: (c) => `<rect x="10" y="10" width="14" height="14" rx="3" fill="${c}"/><rect x="28" y="10" width="14" height="8" rx="3" fill="none" stroke="${c}" stroke-width="2.6"/><rect x="28" y="22" width="14" height="20" rx="3" fill="${c}"/><rect x="10" y="28" width="14" height="14" rx="3" fill="none" stroke="${c}" stroke-width="2.6"/>`,
  shield: (c) => `<path d="M26 9 l14 5 v10 c0 9 -6 15 -14 19 c-8 -4 -14 -10 -14 -19 v-10 z" fill="none" stroke="${c}" stroke-width="2.8" stroke-linejoin="round"/><path d="M20 26 l4 4 l8 -9" fill="none" stroke="${c}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  browser: (c) => `<rect x="9" y="12" width="34" height="28" rx="5" fill="none" stroke="${c}" stroke-width="2.6"/><circle cx="15.5" cy="18.5" r="1.9" fill="${c}"/><circle cx="21.5" cy="18.5" r="1.9" fill="${c}"/><path d="M16 33 l6 -6 l4 3 l8 -8" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  calendar: (c) => `<rect x="2" y="4" width="18" height="16" rx="3" fill="none" stroke="${c}" stroke-width="2"/><line x1="2" y1="9" x2="20" y2="9" stroke="${c}" stroke-width="2"/><line x1="7" y1="1.5" x2="7" y2="5" stroke="${c}" stroke-width="2"/><line x1="15" y1="1.5" x2="15" y2="5" stroke="${c}" stroke-width="2"/>`,
  flame: (c) => `<path d="M11 2 c1 4 6 6 6 12 a6 6 0 0 1 -12 0 c0 -3 2 -5 3 -6 c0 2 1 3 2 3 c0 -4 -1 -6 1 -9 z" fill="${c}"/>`,
  trophy: (c) => `<path d="M6 3 h10 v5 a5 5 0 0 1 -10 0 z" fill="${c}"/><path d="M6 5 h-3 a3 3 0 0 0 3 4 M16 5 h3 a3 3 0 0 1 -3 4" fill="none" stroke="${c}" stroke-width="1.8"/><rect x="9.5" y="12" width="3" height="4" fill="${c}"/><rect x="6" y="16" width="10" height="3" rx="1" fill="${c}"/>`,
  bars: (c) => `<rect x="3" y="11" width="4" height="9" rx="1" fill="${c}"/><rect x="9" y="6" width="4" height="14" rx="1" fill="${c}"/><rect x="15" y="2" width="4" height="18" rx="1" fill="${c}"/>`,
  folder: (c) => `<path d="M2 6 a2 2 0 0 1 2 -2 h5 l2 2 h7 a2 2 0 0 1 2 2 v9 a2 2 0 0 1 -2 2 h-14 a2 2 0 0 1 -2 -2 z" fill="${c}"/>`,
  code: (c) => `<path d="M7 6 l-5 5 l5 5 M15 6 l5 5 l-5 5" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  clock: (c) => `<circle cx="11" cy="11" r="8.5" fill="none" stroke="${c}" stroke-width="2"/><path d="M11 6 v5 l3.5 2.5" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
};

// ---------------------------------------------------------------- data helpers
function weeksOf(days) {
  const cols = [];
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const dow = new Date(`${d.date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || !cols.length) cols.push([]);
    cols.at(-1).push(d);
  }
  return cols;
}
function streaks(days) {
  const s = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let longest = 0, run = 0, longestEnd = null;
  for (const d of s) { run = d.count ? run + 1 : 0; if (run > longest) { longest = run; longestEnd = d.date; } }
  let i = s.length - 1, current = 0;
  if (i >= 0 && s[i].count === 0) i--; // today isn't over
  for (; i >= 0 && s[i].count > 0; i--) current++;
  const since = current ? s[i + 1].date : null;
  return { current, since, longest };
}
const level = (count, max) => (count === 0 ? 0 : count / max > 0.75 ? 4 : count / max > 0.5 ? 3 : count / max > 0.25 ? 2 : 1);

// ---------------------------------------------------------------- cards
function hero(T, phone) {
  const d = new Doc(T);
  const w = phone ? 440 : 880;
  const colors = [T.blue, T.green, T.violet, T.amber, T.rose];
  if (!phone) {
    const h = 250;
    d.frame(w, h); blueprint(d, w, h, "bp");
    d.raw(`<rect x="40" y="46" width="100" height="100" rx="26" fill="${T.blue}"/>`);
    d.text(90, 112, profile.monogram, { f: "display", size: 42, fill: T.on, anchor: "middle" });
    d.text(166, 100, `Hi, I'm ${profile.name}`, { f: "display", size: 50, extra: 'letter-spacing="-1"' });
    d.text(168, 134, `${profile.role} · ${profile.location}`, { size: 16, fill: T.muted });
    d.text(168, 162, profile.tagline, { size: 16 });
    let x = 168;
    profile.tags.forEach((t, i) => { x += d.pill(x, 184, t, colors[i % 5], { size: 12, h: 28 }) + 8; });
    const sw = d.width(profile.links.site.label, "monob", 13) + 28;
    d.pill(w - 32 - sw, 28, profile.links.site.label, T.amber, { f: "monob", size: 13, h: 30, solid: true, pad: 14 });
    return d.render(w, h, `Hi, I'm ${profile.name}. ${profile.role}, ${profile.location}. ${profile.tagline}`);
  }
  const tag = d.wrap(profile.tagline, "body", 17, w - 56);
  const role = d.wrap(`${profile.role} · ${profile.location}`, "body", 15, w - 56);
  let rows = [[]], x = 28;
  for (const t of profile.tags) { const tw = d.width(t, "mono", 12) + 22; if (x + tw > w - 28) { rows.push([]); x = 28; } rows.at(-1).push(t); x += tw + 8; }
  const h = 190 + role.length * 22 + tag.length * 24 + rows.length * 36 + 26;
  d.frame(w, h); blueprint(d, w, h, "bp");
  d.raw(`<rect x="28" y="30" width="76" height="76" rx="20" fill="${T.blue}"/>`);
  d.text(66, 80, profile.monogram, { f: "display", size: 32, fill: T.on, anchor: "middle" });
  const sw = d.width(profile.links.site.label, "monob", 12) + 24;
  d.pill(w - 28 - sw, 30, profile.links.site.label, T.amber, { f: "monob", size: 12, h: 28, solid: true, pad: 12 });
  d.text(28, 158, `Hi, I'm ${profile.name}`, { f: "display", size: 40, extra: 'letter-spacing="-1"' });
  let y = 190;
  role.forEach((l) => { d.text(28, y, l, { size: 15, fill: T.muted }); y += 22; });
  y += 6;
  tag.forEach((l) => { d.text(28, y, l, { size: 17 }); y += 24; });
  y += 4; let i = 0;
  for (const row of rows) { x = 28; for (const t of row) { x += d.pill(x, y, t, colors[i++ % 5], { size: 12, h: 28 }) + 8; } y += 36; }
  return d.render(w, h, `Hi, I'm ${profile.name}. ${profile.role}. ${profile.tagline}`);
}

function badge(T, kind) {
  const d = new Doc(T);
  const link = profile.links[kind];
  const color = { linkedin: T.blue, email: T.green, site: T.amber }[kind];
  const h = 44, w = d.width(link.label, "body", 15) + 66;
  d.raw(`<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${h / 2 - 1}" fill="${T.card}" stroke="${color}" stroke-opacity="0.7" stroke-width="1.5"/>`);
  const glyph = {
    linkedin: `<rect x="17" y="12" width="20" height="20" rx="5" fill="${color}"/><text x="27" y="27" font-family="sa-display" font-size="13" fill="${T.on}" text-anchor="middle">in</text>`,
    email: `<rect x="16" y="14" width="22" height="16" rx="3.5" fill="none" stroke="${color}" stroke-width="2.2"/><path d="M17.5 16 l9.5 7 l9.5 -7" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>`,
    site: `<circle cx="27" cy="22" r="10" fill="none" stroke="${color}" stroke-width="2.2"/><path d="M17 22 h20 M27 12 c-5.5 6 -5.5 14 0 20 M27 12 c5.5 6 5.5 14 0 20" fill="none" stroke="${color}" stroke-width="1.8"/>`,
  }[kind];
  d.fonts.add("display");
  d.raw(glyph);
  d.text(50, 28, link.label, { size: 15 });
  return d.render(w, h, link.label);
}

function github(T, phone, g) {
  const d = new Doc(T);
  const w = phone ? 440 : 880, pad = phone ? 24 : 32;
  const s = streaks(g.last.days);
  const firstYear = g.createdAt.slice(0, 4);
  const sinceTotal = g.years.reduce((a, y) => a + y.total, 0);
  const tiles = [
    [fmt(lastYearTotal(g)), ["contributions in", "the last year"], T.green, "calendar"],
    [`${s.current} ${s.current === 1 ? "day" : "days"}`, s.since ? ["current streak,", `since ${human(s.since).slice(0, -5)}`] : ["current streak"], T.green, "flame"],
    [`${s.longest} ${s.longest === 1 ? "day" : "days"}`, ["longest streak", "in the last year"], T.amber, "trophy"],
    [fmt(sinceTotal), ["contributions", `since ${firstYear}`], T.violet, "bars"],
  ];
  const cols = phone ? 2 : 4, gap = 12;
  const tW = (w - pad * 2 - gap * (cols - 1)) / cols, tH = phone ? 112 : 124;
  const top = phone ? 70 : 80;
  const pills = [
    [String(g.repos), "public repos", T.blue, "folder"],
    [g.topLanguage ?? "n/a", "top language", T.green, "code"],
    [firstYear, "on GitHub since", T.violet, "clock"],
  ];
  const pillRows = phone ? pills.length : 1;
  const h = top + Math.ceil(4 / cols) * (tH + gap) + pillRows * 60 + (phone ? 18 : 24);
  d.frame(w, h);
  d.text(pad, phone ? 44 : 52, "On GitHub", { f: "display", size: phone ? 24 : 28 });
  if (!phone) d.text(w - pad, 50, `redrawn every night · ${human(g.fetchedAt)}`, { f: "mono", size: 12, fill: T.faint, anchor: "end" });
  else d.text(w - pad, 43, human(g.fetchedAt), { f: "mono", size: 11, fill: T.faint, anchor: "end" });
  tiles.forEach(([big, lines, col, glyph], i) => {
    const x = pad + (i % cols) * (tW + gap), y = top + Math.floor(i / cols) * (tH + gap);
    d.raw(`<rect x="${r(x)}" y="${y}" width="${r(tW)}" height="${tH}" rx="16" fill="${col}" fill-opacity="${T.tint}" stroke="${col}" stroke-opacity="${T.stroke}"/>`);
    d.raw(`<g transform="translate(${r(x + tW - 36)} ${y + 14})">${GLYPH[glyph](col)}</g>`);
    d.text(x + 18, y + (phone ? 50 : 56), big, { f: "display", size: phone ? 28 : 34, extra: 'letter-spacing="-0.5"' });
    lines.forEach((l, k) => d.text(x + 18, y + (phone ? 76 : 84) + k * 18, l, { f: "mono", size: phone ? 12 : 13, fill: T.muted }));
  });
  let x = pad, y = top + Math.ceil(4 / cols) * (tH + gap) + 4;
  for (const [v, l, col, glyph] of pills) {
    const pw = phone ? w - pad * 2 : d.width(v, "display", 22) + d.width(l, "mono", 13) + 84;
    d.raw(`<rect x="${r(x)}" y="${y}" width="${r(pw)}" height="50" rx="14" fill="${col}" fill-opacity="${T.tint}" stroke="${col}" stroke-opacity="${T.stroke}"/>`);
    d.raw(`<g transform="translate(${r(x + 16)} ${y + 14})">${GLYPH[glyph](col)}</g>`);
    d.text(x + 48, y + 33, v, { f: "display", size: 22 });
    d.text(x + 58 + d.width(v, "display", 22), y + 32, l, { f: "mono", size: 13, fill: T.muted });
    if (phone) y += 60; else x += pw + 12;
  }
  return d.render(w, h, `On GitHub: ${lastYearTotal(g)} contributions in the last year, current streak ${s.current} days, longest streak ${s.longest} days, ${sinceTotal} contributions since ${firstYear}, ${g.repos} public repos.`);
}

function heatmap(T, phone, g) {
  const d = new Doc(T);
  const w = phone ? 440 : 880, pad = phone ? 20 : 28;
  const nWeeks = phone ? 13 : 26;
  const weeks = weeksOf(g.last.days).slice(-nWeeks);
  const flat = weeks.flat();
  const total = flat.reduce((a, x) => a + x.count, 0);
  const max = Math.max(1, ...flat.map((x) => x.count));
  const gap = 4, cw = (w - pad * 2 - gap * (nWeeks - 1)) / nWeeks, ch = phone ? 24 : 22, top = 86;
  const h = top + 7 * (ch + gap) + 46;
  d.frame(w, h);
  d.spans(pad, 44, [[fmt(total), { f: "display", size: 22 }], [` contributions in the last ${phone ? "3" : "6"} months`, { f: "mono", size: phone ? 13 : 15, fill: T.muted }]]);
  let lastM = -1, lastX = -99;
  weeks.forEach((wk, wi) => {
    const off = wi === 0 ? 7 - wk.length : 0;
    const m = Number(wk.at(-1).date.slice(5, 7)) - 1; // label a week by the month it ends in
    const lx = pad + wi * (cw + gap);
    if (m !== lastM && lx - lastX >= 44) {
      d.text(lx, top - 12, MONTHS[m], { f: "mono", size: 12, fill: T.muted });
      lastX = lx;
    }
    lastM = m;
    wk.forEach((day, di) => {
      const x = pad + wi * (cw + gap), y = top + (di + off) * (ch + gap);
      const lv = level(day.count, max);
      d.raw(`<rect x="${r(x)}" y="${r(y)}" width="${r(cw)}" height="${ch}" rx="5" fill="${T.heat[lv]}"><title>${day.count} on ${day.date}</title></rect>`);
      const fill = lv === 0 ? T.faint : (T.name === "dark" ? (lv >= 3 ? T.on : T.fg) : (lv >= 3 ? "#ffffff" : T.fg));
      d.text(x + cw / 2, y + ch / 2 + 3.6, day.count, { f: lv ? "monob" : "mono", size: 10, fill, anchor: "middle" });
    });
  });
  d.text(pad, h - 18, "contributions per day", { f: "mono", size: 12, fill: T.faint });
  const lx = w - pad - 5 * 16 - 38;
  d.text(lx - 8, h - 18, "Less", { f: "mono", size: 12, fill: T.faint, anchor: "end" });
  T.heat.forEach((c, i) => d.raw(`<rect x="${lx + i * 16}" y="${h - 29}" width="12" height="12" rx="3" fill="${c}" stroke="${T.line}" stroke-width="${i ? 0 : 1}"/>`));
  d.text(w - pad, h - 18, "More", { f: "mono", size: 12, fill: T.faint, anchor: "end" });
  return d.render(w, h, `${total} contributions in the last ${phone ? 3 : 6} months`);
}

function yearGraph(T, phone, days, title) {
  const d = new Doc(T);
  const w = phone ? 440 : 880, pad = phone ? 16 : 24;
  const weeks = weeksOf(days).slice(-53);
  const max = Math.max(1, ...days.map((x) => x.count));
  const gap = phone ? 1.6 : 3, s = (w - pad * 2 - gap * 52) / 53, top = 50;
  const h = top + 7 * (s + gap) + 18;
  d.frame(w, h, { rx: 14 });
  d.text(pad, 32, title, { f: "mono", size: phone ? 12 : 14, fill: T.muted });
  weeks.forEach((wk, wi) => {
    const off = wi === 0 ? 7 - wk.length : 0;
    wk.forEach((day, di) => d.raw(`<rect x="${r(pad + wi * (s + gap))}" y="${r(top + (di + off) * (s + gap))}" width="${r(s)}" height="${r(s)}" rx="${phone ? 1.5 : 3}" fill="${T.heat[level(day.count, max)]}"><title>${day.count} on ${day.date}</title></rect>`));
  });
  return d.render(w, h, title);
}

function chart30(T, phone, g) {
  const d = new Doc(T);
  const w = phone ? 440 : 880, h = phone ? 280 : 310;
  const pts30 = [...g.last.days].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const total = pts30.reduce((a, x) => a + x.count, 0);
  const x0 = phone ? 44 : 64, x1 = w - (phone ? 18 : 30), y0 = 80, y1 = h - (phone ? 70 : 74);
  const nice = Math.max(4, Math.ceil(Math.max(...pts30.map((p) => p.count)) / 4) * 4);
  const X = (i) => x0 + (i / (pts30.length - 1)) * (x1 - x0), Y = (v) => y1 - (v / nice) * (y1 - y0);
  d.frame(w, h);
  d.spans(phone ? 20 : 28, 44, [[fmt(total), { f: "display", size: 22 }], [" contributions in the last 30 days", { f: "mono", size: phone ? 13 : 15, fill: T.muted }]]);
  for (let k = 0; k <= 4; k++) {
    const v = (nice / 4) * k, y = Y(v);
    d.raw(`<line x1="${x0}" x2="${x1}" y1="${r(y)}" y2="${r(y)}" stroke="${T.line}" ${k ? 'stroke-dasharray="3 5"' : ""}/>`);
    d.text(x0 - 10, y + 4, v, { f: "mono", size: 11, fill: T.faint, anchor: "end" });
  }
  pts30.forEach((p, i) => {
    const day = Number(p.date.slice(8));
    if (!phone || i % 5 === 0 || i === pts30.length - 1) d.text(X(i), y1 + 20, day, { f: "mono", size: phone ? 11 : 10.5, fill: T.faint, anchor: "middle" });
    if (i === 0 || day === 1) d.text(X(i), y1 + 38, MONTHS[Number(p.date.slice(5, 7)) - 1], { f: "mono", size: 11, fill: T.muted, anchor: "middle" });
  });
  const P = pts30.map((p, i) => [X(i), Y(p.count)]);
  let path = `M${r(P[0][0])},${r(P[0][1])}`;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], e = P[Math.min(P.length - 1, i + 2)];
    path += ` C${r(b[0] + (c[0] - a[0]) / 6)},${r(Math.min(y1, b[1] + (c[1] - a[1]) / 6))} ${r(c[0] - (e[0] - b[0]) / 6)},${r(Math.min(y1, c[1] - (e[1] - b[1]) / 6))} ${r(c[0])},${r(c[1])}`;
  }
  d.defs.push(`<linearGradient id="ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.green}" stop-opacity="0.35"/><stop offset="1" stop-color="${T.green}" stop-opacity="0"/></linearGradient>`);
  d.raw(`<path d="${path} L${x1},${y1} L${x0},${y1} Z" fill="url(#ar)"/><path d="${path}" fill="none" stroke="${T.green}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`);
  if (total === 0) {
    const lines = d.wrap("No public commits this month. Most of my work lives in private client repositories.", "body", 14, x1 - x0 - 40);
    lines.forEach((l, i) => d.text((x0 + x1) / 2, (y0 + y1) / 2 - (lines.length - 1) * 10 + i * 20, l, { size: 14, fill: T.muted, anchor: "middle" }));
  }
  return d.render(w, h, `${total} contributions in the last 30 days`);
}

function whoami(T, phone) {
  const d = new Doc(T);
  const p = profile.whoami;
  const w = phone ? 440 : 880, size = phone ? 13 : 14, maxW = w - (phone ? 56 : 72);
  const lines = [];
  lines.push(["prompt", "whoami"]);
  d.wrap(p.summary, "monob", size, maxW).forEach((l) => lines.push(["strong", l]));
  d.wrap(p.bio, "mono", size, maxW).forEach((l) => lines.push(["plain", l]));
  lines.push(["gap"], ["prompt", "cat now.txt"]);
  for (const n of p.now) d.wrap(n, "mono", size, maxW - 22).forEach((l, i) => lines.push([i ? "cont" : "arrow", l]));
  lines.push(["cursor"]);
  const lh = phone ? 22 : 25;
  const h = 72 + lines.reduce((a, [k]) => a + (k === "gap" ? 10 : lh), 0) + 12;
  d.frame(w, h, { fill: T.term });
  d.raw(`<path d="M1 18 a17 17 0 0 1 17 -17 h${w - 36} a17 17 0 0 1 17 17 v26 h-${w - 2} z" fill="${T.card}"/><line x1="1" x2="${w - 1}" y1="44" y2="44" stroke="${T.line}"/>
<circle cx="24" cy="22" r="6" fill="#f2665e"/><circle cx="44" cy="22" r="6" fill="#f5bd4f"/><circle cx="64" cy="22" r="6" fill="#58c35a"/>`);
  d.text(w / 2, 27, `${p.host}: ~`, { f: "mono", size: 12, fill: T.faint, anchor: "middle" });
  let y = 84; const x = phone ? 24 : 32;
  for (const [k, s] of lines) {
    if (k === "prompt") d.spans(x, y, [["$", { f: "monob", size, fill: T.rose }], [` ${s}`, { f: "monob", size }]]);
    if (k === "strong") d.text(x, y, s, { f: "monob", size, fill: T.blue });
    if (k === "plain") d.text(x, y, s, { f: "mono", size, fill: T.fg });
    if (k === "arrow") d.spans(x, y, [["→", { f: "mono", size, fill: T.green }], [` ${s}`, { f: "mono", size, fill: T.muted }]]);
    if (k === "cont") d.text(x + 22, y, s, { f: "mono", size, fill: T.muted });
    if (k === "cursor") {
      d.text(x, y, "$", { f: "monob", size, fill: T.rose });
      d.raw(`<rect x="${x + 16}" y="${y - size + 1}" width="${size * 0.62}" height="${size + 3}" fill="${T.fg}"/>`);
    }
    y += k === "gap" ? 10 : lh;
  }
  return d.render(w, h, `whoami: ${p.summary}. ${p.bio} Now: ${p.now.join(". ")}.`);
}

function label(T, phone, title, chip, color) {
  const d = new Doc(T);
  const w = phone ? 440 : 880, size = phone ? 22 : 24, h = phone ? 56 : 60;
  const tw = d.width(title, "display", size) + 36;
  d.raw(`<rect x="0" y="8" width="${r(tw)}" height="${h - 14}" rx="12" fill="${color}"/>`);
  d.text(tw / 2, h / 2 + size * 0.36 + 1, title, { f: "display", size, fill: T.on, anchor: "middle" });
  d.pill(tw + 12, h / 2 - 13 + 1, chip, T.muted, { size: 12, h: 26 });
  return d.render(w, h, title);
}

function project(T, phone, p) {
  const d = new Doc(T);
  const col = tintOf(T, p.tint);
  const w = phone ? 300 : 430;
  const titleSize = phone ? 24 : 21, lineSize = phone ? 18 : 14.5;
  const titleLines = d.wrap(p.name, "display", titleSize, phone ? w - 48 : w - 140);
  const desc = d.wrap(p.line, "body", lineSize, w - 48);
  let h;
  if (!phone) {
    h = 250;
    d.frame(w, h, { stroke: col });
    d.raw(`<rect x="1" y="1" width="${w - 2}" height="92" rx="17" fill="${col}" fill-opacity="${T.tint * 0.7}"/>`);
    d.raw(`<rect x="24" y="24" width="56" height="56" rx="15" fill="${col}" fill-opacity="${T.tint * 1.4}" stroke="${col}" stroke-opacity="${T.stroke}"/><g transform="translate(26 26)">${GLYPH[p.icon](col)}</g>`);
    d.text(96, 48, titleLines[0], { f: "display", size: titleSize });
    d.pill(96, 60, p.status, col, { size: 11, h: 22, pad: 9 });
    if (p.url) d.raw(`<rect x="${w - 48}" y="24" width="26" height="26" rx="7" fill="${col}" fill-opacity="${T.tint * 1.4}" stroke="${col}" stroke-opacity="${T.stroke}"/><path d="M${w - 40} 42 l10 -10 M${w - 38} 32 h8 v8" fill="none" stroke="${col}" stroke-width="2.2" stroke-linecap="round"/>`);
    desc.slice(0, 3).forEach((l, i) => d.text(24, 124 + i * 21, l, { size: lineSize }));
    let x = 24;
    for (const c of p.chips) x += d.pill(x, 180, c, T.muted, { size: 11, h: 24, pad: 9 }) + 7;
    d.text(24, 228, p.fact, { f: "mono", size: 12, fill: T.faint });
  } else {
    h = 120 + titleLines.length * 30 + desc.length * 25 + 60;
    d.frame(w, h, { stroke: col });
    d.raw(`<rect x="22" y="22" width="60" height="60" rx="16" fill="${col}" fill-opacity="${T.tint * 1.4}" stroke="${col}" stroke-opacity="${T.stroke}"/><g transform="translate(26 26)">${GLYPH[p.icon](col)}</g>`);
    if (p.url) d.raw(`<rect x="${w - 52}" y="22" width="30" height="30" rx="8" fill="${col}" fill-opacity="${T.tint * 1.4}" stroke="${col}" stroke-opacity="${T.stroke}"/><path d="M${w - 43} 43 l12 -12 M${w - 41} 31 h10 v10" fill="none" stroke="${col}" stroke-width="2.4" stroke-linecap="round"/>`);
    let y = 118;
    titleLines.forEach((l) => { d.text(24, y, l, { f: "display", size: titleSize }); y += 30; });
    d.pill(24, y - 12, p.status, col, { size: 13, h: 26 });
    y += 44;
    desc.forEach((l) => { d.text(24, y, l, { size: lineSize }); y += 25; });
  }
  return d.render(w, h, `${p.name}: ${p.line} ${p.status}.`);
}

function stack(T, phone) {
  const d = new Doc(T);
  const w = phone ? 440 : 880, pad = phone ? 22 : 32, labelW = phone ? 0 : 150, chipH = 32;
  let y = phone ? 26 : 32;
  const body = [];
  profile.stack.forEach((group, gi) => {
    if (gi) { d.raw(`<line x1="${pad}" x2="${w - pad}" y1="${y - 12}" y2="${y - 12}" stroke="${T.line}"/>`); }
    let x = pad + labelW;
    if (phone) { d.text(pad, y + 12, group.label, { f: "display", size: 15, fill: T.muted }); y += 24; }
    else d.text(pad, y + 21, group.label, { f: "display", size: 15, fill: T.muted });
    for (const [name, slug] of group.items) {
      const hasIcon = Boolean(slug && icons[slug]);
      const cw = d.width(name, "body", 13.5) + 24 + (hasIcon ? 22 : 0);
      if (x + cw > w - pad) { x = pad + labelW; y += chipH + 8; }
      d.raw(`<rect x="${r(x)}" y="${y}" width="${r(cw)}" height="${chipH}" rx="9" fill="${T.card2}" stroke="${T.line}"/>`);
      if (hasIcon) brand(d, slug, x + 11, y + 9, 14, readable(T, icons[slug].hex));
      d.text(x + 12 + (hasIcon ? 22 : 0), y + 21, name, { size: 13.5 });
      x += cw + 8;
    }
    y += chipH + 26;
  });
  const h = y - 4;
  d.parts.unshift(`<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="18" fill="${T.card}" stroke="${T.line}"/>`);
  return d.render(w, h, "Tech stack: " + profile.stack.map((g) => `${g.label}: ${g.items.map((i) => i[0]).join(", ")}`).join(". "));
}

function certs(T, phone) {
  const d = new Doc(T);
  const w = phone ? 440 : 880, pad = phone ? 22 : 32;
  const rowH = phone ? 76 : 56;
  const h = 20 + profile.certifications.length * rowH + 8;
  d.frame(w, h);
  const colors = { "exam booked": T.blue, rescheduling: T.faint, "up next": T.violet, passed: T.green, studying: T.amber };
  profile.certifications.forEach(([name, status, when], i) => {
    const y = 20 + i * rowH;
    if (i) d.raw(`<line x1="${pad}" x2="${w - pad}" y1="${y - 2}" y2="${y - 2}" stroke="${T.line}"/>`);
    const label = when ? `${status} · ${when}` : status;
    if (phone) {
      d.text(pad, y + 26, name, { f: "display", size: 15 });
      d.pill(pad, y + 38, label, colors[status] ?? T.muted, { size: 12, h: 26 });
    } else {
      d.text(pad, y + 33, name, { f: "display", size: 17 });
      const pw = d.width(label, "mono", 12) + 22;
      d.pill(w - pad - pw, y + 14, label, colors[status] ?? T.muted, { size: 12, h: 26 });
    }
  });
  return d.render(w, h, "Certifications: " + profile.certifications.map((c) => `${c[0]} (${c[1]}${c[2] ? ", " + c[2] : ""})`).join(", "));
}

// ---------------------------------------------------------------- README
const pic = (name, alt, width = "100%", { phone = true, height } = {}) => {
  const size = height ? `height="${height}"` : `width="${width}"`;
  const phoneSrc = phone ? `<source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="assets/${name}-phone-dark.svg"><source media="(max-width: 600px)" srcset="assets/${name}-phone-light.svg">` : "";
  return `<picture>${phoneSrc}<source media="(prefers-color-scheme: dark)" srcset="assets/${name}-dark.svg"><img src="assets/${name}-light.svg" ${size} alt="${esc(alt)}"></picture>`;
};

function readme(g) {
  const L = profile.links;
  const out = [];
  out.push(`<a href="${L.site.url}">${pic("hero", `Hi, I'm ${profile.name}. ${profile.role}, ${profile.location}. ${profile.tagline}`)}</a>`);
  out.push(`<p align="center">\n<a href="${L.linkedin.url}">${pic("badge-linkedin", "LinkedIn", "", { phone: false, height: 44 })}</a>\n<a href="${L.email.url}">${pic("badge-email", L.email.label, "", { phone: false, height: 44 })}</a>\n<a href="${L.site.url}">${pic("badge-site", L.site.label, "", { phone: false, height: 44 })}</a>\n</p>`);
  if (g && profile.showGitHubActivity !== false) {
    const s = streaks(g.last.days);
    const total = lastYearTotal(g);
    out.push(`## ${fmt(total)} contributions in the last year`);
    out.push(pic("github", `On GitHub: ${fmt(total)} contributions in the last year, ${s.current}-day public contribution streak, ${g.repos} public repos.`));
    out.push(pic("graph-6m", "Public contributions per day over the last 6 months"));
    out.push(`<details><summary>Last 12 months: ${fmt(total)} profile contributions</summary>\n\n${pic("graph-12m", `${fmt(total)} profile contributions in the last 12 months`)}\n\n</details>`);
    for (const y of g.years) out.push(`<details><summary>${y.year}: ${fmt(y.total)} ${y.total === 1 ? "contribution" : "contributions"}</summary>\n\n${pic(`graph-${y.year}`, `${fmt(y.total)} contributions in ${y.year}`)}\n\n</details>`);
    out.push(pic("line-30d", "Public contributions over the last 30 days"));
    out.push(`<p align="center"><sub>The annual total is my full-profile count. The daily heatmap, streaks and charts use public contribution data, so they may not add up to this total. <a href="https://github.com/${profile.user}">View the full profile graph</a>.</sub></p>`);
  }
  out.push(pic("whoami", `whoami: ${profile.whoami.summary}. ${profile.whoami.bio}`));
  out.push(pic("label-build", "What I build"));
  out.push(`<p align="center">\n${profile.projects.map((p) => {
    const img = pic(`project-${p.id}`, `${p.name}: ${p.line} ${p.status}.`, "49%");
    return p.url ? `<a href="${p.url}">${img}</a>` : img;
  }).join("\n")}\n</p>`);
  out.push(`<p align="center"><sub>Client work is under NDA, so it's described in general terms.</sub></p>`);
  out.push(pic("label-stack", "Tech stack"));
  out.push(pic("stack", "Tech stack: " + profile.stack.map((gr) => `${gr.label}: ${gr.items.map((i) => i[0]).join(", ")}`).join(". ")));
  out.push(pic("label-certs", "Certifications"));
  out.push(pic("certs", "Certifications: " + profile.certifications.map((c) => `${c[0]} (${c[1]})`).join(", ")));
  out.push(`<p align="center"><sub>Cards redrawn every night from public GitHub data by a GitHub Action in this repo · <a href="${L.site.url}">${L.site.label}</a></sub></p>`);
  return out.join("\n\n") + "\n";
}

// ---------------------------------------------------------------- main
let g = null, stale = false;
const cacheUrl = new URL("data/github-cache.json", root);
try {
  const i = process.argv.indexOf("--from-file");
  g = i > -1 ? JSON.parse(await readFile(process.argv[i + 1], "utf8")) : await fetchGitHub(profile.user);
  if (i < 0) await writeFile(cacheUrl, JSON.stringify(g));
} catch (error) {
  console.error("GitHub data could not be read:", error.message);
  g = JSON.parse(await readFile(cacheUrl, "utf8").catch(() => "null"));
  stale = true;
  if (g) console.error(`Drawing from the saved copy of ${g.fetchedAt}.`);
}

const out = new URL("assets/", root);
await mkdir(out, { recursive: true });
const files = {};
for (const T of Object.values(THEMES)) {
  for (const phone of [false, true]) {
    const sfx = `${phone ? "phone-" : ""}${T.name}`;
    files[`hero-${sfx}`] = hero(T, phone);
    files[`whoami-${sfx}`] = whoami(T, phone);
    files[`label-build-${sfx}`] = label(T, phone, "What I build", `${profile.projects.length} projects`, T.amber);
    files[`label-stack-${sfx}`] = label(T, phone, "Tech stack", "what I work with", T.blue);
    files[`label-certs-${sfx}`] = label(T, phone, "Certifications", "in progress", T.violet);
    files[`stack-${sfx}`] = stack(T, phone);
    files[`certs-${sfx}`] = certs(T, phone);
    for (const p of profile.projects) files[`project-${p.id}-${sfx}`] = project(T, phone, p);
    if (g) {
      files[`github-${sfx}`] = github(T, phone, g);
      files[`graph-6m-${sfx}`] = heatmap(T, phone, g);
      files[`graph-12m-${sfx}`] = yearGraph(T, phone, g.last.days, `Last 12 months: ${fmt(g.last.total)} contributions`);
      for (const y of g.years) files[`graph-${y.year}-${sfx}`] = yearGraph(T, phone, y.days, `${y.year}: ${fmt(y.total)} contributions`);
      files[`line-30d-${sfx}`] = chart30(T, phone, g);
    }
  }
  for (const k of ["linkedin", "email", "site"]) files[`badge-${k}-${T.name}`] = badge(T, k);
}
for (const [name, svg] of Object.entries(files)) await writeFile(new URL(`${name}.svg`, out), svg);
await writeFile(new URL("README.md", root), readme(g));
console.log(`Wrote ${Object.keys(files).length} cards and README.md${g ? ` (${g.last.total} contributions in the last year)` : " (no GitHub data yet)"}.`);
if (stale) process.exitCode = 1;
