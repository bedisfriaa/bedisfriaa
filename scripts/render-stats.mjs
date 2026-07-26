#!/usr/bin/env node
/**
 * render-stats.mjs — true commit stats across PRIVATE repos → assets/stats.svg
 *
 * Why REST pagination instead of `contributionsCollection`:
 *   contributionsCollection returns 0 across the board for this account
 *   ("Include private contributions on my profile" is off, every repo private).
 *   `GET /repos/{o}/{r}/commits?per_page=1&author={login}` + the `Link: rel="last"`
 *   header is ground truth and independent of any profile privacy setting.
 *
 * Node 20+ ESM. No dependencies — global fetch only.
 * Auth: process.env.GITHUB_TOKEN (fine-grained PAT: metadata + contents, read-only).
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- config ----

const API = 'https://api.github.com';
const UA = 'bedisfriaa-profile-stats';
const CONCURRENCY = 8;
const TOP_LANGUAGES = 4;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const OUT_FILE = join(REPO_ROOT, 'assets', 'stats.svg');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error(
    'render-stats: GITHUB_TOKEN is not set.\n' +
      '  Local:  GITHUB_TOKEN="$(gh auth token)" node scripts/render-stats.mjs\n' +
      '  Action: env: { GITHUB_TOKEN: ${{ secrets.STATS_TOKEN }} }',
  );
  process.exit(1);
}

// ------------------------------------------------------------- api client ---

/** @returns {Promise<{ res: Response, body: any }>} */
async function gh(path, { allowStatus = [] } = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
    },
  });

  if (!res.ok && !allowStatus.includes(res.status)) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `GitHub ${res.status} ${res.statusText} for ${url}\n${detail.slice(0, 400)}`,
    );
  }

  const body = res.status === 204 || !res.ok ? null : await res.json().catch(() => null);
  return { res, body };
}

/** Pull `page=N` out of the `Link: <...>; rel="last"` header. 0 if absent. */
function lastPageFromLink(linkHeader) {
  if (!linkHeader) return 0;
  const m = linkHeader.match(/<([^>]+)>\s*;\s*rel="last"/);
  if (!m) return 0;
  const page = new URL(m[1]).searchParams.get('page');
  const n = Number(page);
  return Number.isFinite(n) ? n : 0;
}

/** Bounded-parallel map. Keeps us well inside the 5,000/hr REST budget. */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ------------------------------------------------------------ data lookup ---

async function listOwnedRepos() {
  const repos = [];
  for (let page = 1; page <= 10; page++) {
    const { body } = await gh(
      `/user/repos?per_page=100&affiliation=owner&sort=created&direction=asc&page=${page}`,
    );
    if (!Array.isArray(body) || body.length === 0) break;
    repos.push(...body);
    if (body.length < 100) break;
  }
  // Forks are somebody else's commits; they would inflate every figure on the card.
  return repos.filter((r) => !r.fork);
}

/**
 * Commit count + earliest authored date for one repo.
 * Costs at most 2 requests: page 1 (count via Link) then the last page (earliest).
 */
async function repoCommits(owner, name, login) {
  const base = `/repos/${owner}/${name}/commits?per_page=1&author=${encodeURIComponent(login)}`;

  // 409 = empty repository. Not an error, just zero commits.
  const first = await gh(base, { allowStatus: [409, 404] });
  if (!first.res.ok) return { count: 0, firstCommit: null };

  const items = Array.isArray(first.body) ? first.body : [];
  const last = lastPageFromLink(first.res.headers.get('link'));
  const count = last > 0 ? last : items.length;
  if (count === 0) return { count: 0, firstCommit: null };

  // Oldest commit lives on the final page (the API returns newest-first).
  let oldest = items[0];
  if (last > 1) {
    const tail = await gh(`${base}&page=${last}`, { allowStatus: [409, 404] });
    if (tail.res.ok && Array.isArray(tail.body) && tail.body.length) oldest = tail.body[0];
  }

  const iso =
    oldest?.commit?.author?.date ?? oldest?.commit?.committer?.date ?? null;
  return { count, firstCommit: iso ? new Date(iso) : null };
}

async function repoLanguages(owner, name) {
  const { res, body } = await gh(`/repos/${owner}/${name}/languages`, {
    allowStatus: [404, 409],
  });
  return res.ok && body && typeof body === 'object' ? body : {};
}

async function collect() {
  const { body: me } = await gh('/user');
  const login = me.login;

  const repos = await listOwnedRepos();

  const perRepo = await mapPool(repos, CONCURRENCY, async (r) => {
    const [commits, languages] = await Promise.all([
      repoCommits(r.owner.login, r.name, login),
      repoLanguages(r.owner.login, r.name),
    ]);
    return { name: r.name, private: r.private, ...commits, languages };
  });

  const totalCommits = perRepo.reduce((a, r) => a + r.count, 0);

  const firstDates = perRepo.map((r) => r.firstCommit).filter(Boolean);
  const earliest = firstDates.length
    ? new Date(Math.min(...firstDates.map((d) => d.getTime())))
    : null;
  const days = earliest
    ? Math.max(1, Math.floor((Date.now() - earliest.getTime()) / 86_400_000))
    : 0;

  const bytes = new Map();
  for (const r of perRepo) {
    for (const [lang, n] of Object.entries(r.languages)) {
      bytes.set(lang, (bytes.get(lang) ?? 0) + n);
    }
  }
  const totalBytes = [...bytes.values()].reduce((a, b) => a + b, 0);
  const languages = [...bytes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_LANGUAGES)
    .map(([name, n]) => ({ name, bytes: n, pct: totalBytes ? (n / totalBytes) * 100 : 0 }));

  return {
    login,
    perRepo: perRepo.sort((a, b) => b.count - a.count),
    totalCommits,
    repoCount: perRepo.length,
    days,
    earliest,
    languages,
    totalBytes,
  };
}

// --------------------------------------------------------------- svg build --

const escapeXml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Geometry — must stay in lockstep with assets/architecture.svg's 900-wide grid.
const W = 900;
const H = 260;
const LEFT_X = 40;
const DIV_X = 430;
const BAR_X = 470;
const BAR_W = 390; // 470 + 390 = 860, mirroring the 40px left margin
const RIGHT_EDGE = BAR_X + BAR_W;

function buildSvg(data) {
  const generated = new Date().toISOString().slice(0, 10);

  const figures = [
    { value: group(data.totalCommits), caption: 'COMMITS' },
    { value: group(data.repoCount), caption: 'REPOSITORIES' },
    { value: group(data.days), caption: 'DAYS BUILDING' },
  ];

  // Left column: three rows across the 52..208 band.
  const figureRows = figures
    .map((f, i) => {
      const top = 52 + i * 52;
      return (
        `<g class="stat f${i}">` +
        `<text class="fig" x="${LEFT_X}" y="${top + 30}">${escapeXml(f.value)}</text>` +
        `<text class="cap" x="${LEFT_X}" y="${top + 46}">${escapeXml(f.caption)}</text>` +
        `</g>`
      );
    })
    .join('');

  // Right column: four language bars. Static width is the FULL width, so a
  // renderer that ignores CSS animation still shows a finished card.
  const langRows = data.languages
    .map((l, i) => {
      const top = 52 + i * 44;
      const w = Math.max(1, +((BAR_W * l.pct) / 100).toFixed(2));
      return (
        `<g>` +
        `<text class="lang" x="${BAR_X}" y="${top + 10}">${escapeXml(l.name)}</text>` +
        `<text class="pct" x="${RIGHT_EDGE}" y="${top + 10}" text-anchor="end">${l.pct.toFixed(1)}%</text>` +
        `<rect class="track" x="${BAR_X}" y="${top + 18}" width="${BAR_W}" height="6" rx="3"/>` +
        `<rect class="bar b${i}" x="${BAR_X}" y="${top + 18}" width="${w}" height="6" rx="3"/>` +
        `</g>`
      );
    })
    .join('');

  const figureDelays = figures.map((_, i) => `.f${i}{animation-delay:${i * 120}ms}`).join('');
  const barDelays = data.languages
    .map((_, i) => `.b${i}{animation-delay:${320 + i * 120}ms}`)
    .join('');

  const css = `
:root{--fg:#1f2328;--muted:#656d76;--line:#d0d7de;--accent:#b8622f}
@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--muted:#8b949e;--line:#30363d;--accent:#e8944f}}
text{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}
.fig{font-size:34px;font-weight:600;fill:var(--fg);letter-spacing:-0.02em}
.cap{font-size:10px;fill:var(--muted);letter-spacing:0.14em}
.lang{font-size:12px;fill:var(--fg)}
.pct{font-size:12px;fill:var(--muted)}
.foot{font-size:10px;fill:var(--muted);letter-spacing:0.08em}
.rule{stroke:var(--line);stroke-width:1}
.track{fill:var(--line)}
.bar{fill:var(--accent);transform-box:fill-box;transform-origin:left center;animation:draw 760ms cubic-bezier(.22,.68,.28,1) both}
.stat{animation:rise 620ms cubic-bezier(.22,.68,.28,1) both}
${figureDelays}
${barDelays}
@keyframes draw{from{transform:scaleX(.001)}to{transform:scaleX(1)}}
@keyframes rise{from{opacity:.001;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.bar,.stat{animation:none}}
`.trim();

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="GitHub statistics">
<title>${group(data.totalCommits)} commits across ${data.repoCount} repositories in ${data.days} days</title>
<style><![CDATA[
${css}
]]></style>
${figureRows}
<line class="rule" x1="${DIV_X}" y1="44" x2="${DIV_X}" y2="212"/>
${langRows}
<line class="rule" x1="${LEFT_X}" y1="228" x2="${RIGHT_EDGE}" y2="228"/>
<text class="foot" x="${LEFT_X}" y="246">generated ${generated}</text>
</svg>
`;
}

// ---------------------------------------------------------------- entry -----

async function main() {
  const data = await collect();
  const svg = buildSvg(data);

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, svg, 'utf8');

  const bytes = Buffer.byteLength(svg, 'utf8');
  console.log(`user            ${data.login}`);
  console.log(`repos           ${data.repoCount} (forks excluded)`);
  console.log(`commits         ${group(data.totalCommits)}`);
  console.log(
    `days building   ${data.days}` +
      (data.earliest ? `  (first commit ${data.earliest.toISOString().slice(0, 10)})` : ''),
  );
  for (const r of data.perRepo) {
    console.log(`  ${r.name.padEnd(24)} ${String(r.count).padStart(6)}`);
  }
  console.log('languages');
  for (const l of data.languages) {
    console.log(`  ${l.name.padEnd(24)} ${l.pct.toFixed(1)}%  ${group(l.bytes)} bytes`);
  }
  console.log(`wrote           ${OUT_FILE} (${bytes} bytes)`);
}

main().catch((err) => {
  console.error(`render-stats failed: ${err.message}`);
  process.exit(1);
});
