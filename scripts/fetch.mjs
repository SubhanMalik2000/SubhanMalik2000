// Reads every GitHub number the README shows. All sources are public: no secret is needed.
// GITHUB_TOKEN, when set (the Action passes the built-in one), only lifts the REST rate limit.

const UA = "subhanmalik2000-profile (github.com/SubhanMalik2000/SubhanMalik2000)";

async function get(url, { json = false } = {}) {
  const headers = { "User-Agent": UA };
  if (json && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  if (!json) headers.Accept = "text/html";
  let res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (res.status === 401 && headers.Authorization) {
    // A bad token shouldn't stop the build: public data is readable without one.
    delete headers.Authorization;
    res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  }
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return json ? res.json() : res.text();
}

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/** Public contributions page -> { total, days: [{date, count}] }. Counts come from each day's tooltip. */
export function parseCalendar(html) {
  const tips = new Map();
  for (const m of html.matchAll(/<tool-tip\b([^>]*)>([^<]*)<\/tool-tip>/g)) {
    const id = attr(m[1], "for");
    const t = m[2].trim().match(/^(No|[\d,]+) contributions? on/);
    if (id && t) tips.set(id, t[1] === "No" ? 0 : Number(t[1].replace(/,/g, "")));
  }
  const days = [];
  for (const m of html.matchAll(/<td\b[^>]*\bdata-date="[^"]*"[^>]*>/g)) {
    const date = attr(m[0], "data-date");
    const id = attr(m[0], "id");
    if (!tips.has(id)) throw new Error(`no tooltip for ${date}`);
    days.push({ date, count: tips.get(id) });
  }
  if (days.length < 7) throw new Error("contribution calendar not found");
  days.sort((a, b) => a.date.localeCompare(b.date));
  const heading = html.match(/(No|[\d,]+)\s+contributions?\s+in\s+(?:the last year|\d{4})/);
  const total = heading ? (heading[1] === "No" ? 0 : Number(heading[1].replace(/,/g, ""))) : days.reduce((a, d) => a + d.count, 0);
  return { total, days };
}

export async function fetchGitHub(user, today = new Date()) {
  const u = await get(`https://api.github.com/users/${user}`, { json: true });
  const repos = [];
  for (let page = 1; page < 10; page++) {
    const batch = await get(`https://api.github.com/users/${user}/repos?type=owner&per_page=100&page=${page}`, { json: true });
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  const own = repos.filter((r) => !r.fork);
  const langs = new Map();
  for (const r of own) if (r.language) langs.set(r.language, (langs.get(r.language) ?? 0) + 1);

  const base = `https://github.com/users/${user}/contributions`;
  const last = parseCalendar(await get(base));
  const years = [];
  const first = new Date(u.created_at).getUTCFullYear();
  for (let y = today.getUTCFullYear(); y >= first; y--) {
    const cal = parseCalendar(await get(`${base}?from=${y}-01-01&to=${y}-12-31`));
    years.push({ year: y, total: cal.total, days: cal.days.filter((d) => d.date.startsWith(String(y))) });
  }
  return {
    login: u.login,
    createdAt: u.created_at.slice(0, 10),
    repos: u.public_repos,
    followers: u.followers,
    stars: repos.reduce((a, r) => a + r.stargazers_count, 0),
    topLanguage: [...langs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    last,
    years,
    fetchedAt: today.toISOString().slice(0, 10),
  };
}
