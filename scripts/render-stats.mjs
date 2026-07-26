#!/usr/bin/env node
/**
 * render-stats.mjs — profile stats card → assets/stats.svg
 *
 * ┌─ PERMISSION CONTRACT ────────────────────────────────────────────────────┐
 * │ Runs on a fine-grained PAT carrying ONLY `Metadata: Read`.               │
 * │ It must never need `Contents: Read` — that permission would let this     │
 * │ token read the SOURCE of every private repo, which is absurd access for  │
 * │ a stats card. Every data source below is chosen to stay inside Metadata. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Endpoint → permission audit. This script makes exactly THREE kinds of
 * request. Keep this list in sync with the code; if a fourth appears, justify
 * it here first.
 *
 *   1. POST /graphql
 *      user(login).contributionsCollection.contributionCalendar.totalContributions
 *      → NO repository permission. This is public profile data — the same
 *        number on the profile contribution graph, visible to anonymous
 *        visitors. The token only satisfies GraphQL's "be authenticated"
 *        rule. It includes private work because the account has "Include
 *        private contributions on my profile" enabled. Note it is queried
 *        via `user(login:)`, NOT `viewer`, precisely so it stays public data.
 *
 *   2. GET /user/repos?affiliation=owner
 *      → Metadata: Read. Listed under "Repository permissions for Metadata"
 *        in GitHub's fine-grained-PAT permission reference.
 *
 *   3. GET /repos/{owner}/{repo}/languages
 *      → Metadata: Read. Also listed under "Repository permissions for
 *        Metadata" in that same reference — NOT under Contents. The endpoint
 *        returns only the byte breakdown GitHub computed at index time; no
 *        file content, no tree, no diff, which is why it is metadata-gated.
 *
 * Deliberately ABSENT: `GET /repos/{owner}/{repo}/commits`. The permission
 * reference lists it under "Repository permissions for Contents" — read
 * access to the source of every private repo. That is exactly the access
 * this rewrite removes, and it is why FIRST_COMMIT below is a hard-coded
 * constant: deriving the first-commit date from the API would drag
 * Contents: Read straight back in for the sake of one unchanging date.
 *
 * Also deliberately absent: `GET /user`. It was only ever used to print the
 * token's login, and it is the one endpoint whose fine-grained permission
 * could not be confirmed from the reference — so it is gone rather than
 * left as an unverified claim.
 *
 * Node 20+ ESM. No dependencies — global fetch only.
 * Auth: process.env.GITHUB_TOKEN
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- config ----

const API = 'https://api.github.com';
const GRAPHQL = 'https://api.github.com/graphql';
const UA = 'bedisfriaa-profile-stats';
const CONCURRENCY = 8;
const TOP_LANGUAGES = 4;

/**
 * First commit on the account, verified once from the commit record.
 * It is a historical fact: it never changes, so it does not need to be a
 * live lookup — and making it one would require `Contents: Read` on every
 * repo just to read a date. Hard-coding it is what keeps this script inside
 * the Metadata-only permission budget.
 */
const FIRST_COMMIT = '2026-04-25'; // verified from the commit record; never changes

/** Profile whose PUBLIC contribution calendar is read. */
const PROFILE_LOGIN = process.env.GITHUB_LOGIN || 'bedisfriaa';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const OUT_FILE = join(REPO_ROOT, 'assets', 'stats.svg');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error(
    'render-stats: GITHUB_TOKEN is not set.\n' +
      '  Local:  GITHUB_TOKEN="$(gh auth token)" node scripts/render-stats.mjs\n' +
      '  Action: env: { GITHUB_TOKEN: ${{ secrets.STATS_TOKEN }} }\n' +
      '  Token:  fine-grained PAT, Metadata: Read only. Contents is NOT needed.',
  );
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': UA,
};

// ------------------------------------------------------------- api client ---

/** @returns {Promise<{ res: Response, body: any }>} */
async function gh(path, { allowStatus = [] } = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const res = await fetch(url, { headers: HEADERS });

  if (!res.ok && !allowStatus.includes(res.status)) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `GitHub ${res.status} ${res.statusText} for ${url}\n${detail.slice(0, 400)}`,
    );
  }

  const body = res.status === 204 || !res.ok ? null : await res.json().catch(() => null);
  return { res, body };
}

/** POST a GraphQL query. Throws on transport errors AND on `errors[]`. */
async function graphql(query, variables = {}) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub GraphQL ${res.status} ${res.statusText}\n${text.slice(0, 400)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`GitHub GraphQL returned non-JSON:\n${text.slice(0, 400)}`);
  }

  if (Array.isArray(json.errors) && json.errors.length) {
    throw new Error(
      `GitHub GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`,
    );
  }
  return json.data;
}

/**
 * Settle every promise, then rethrow the first rejection.
 *
 * NOT `Promise.all`: that rejects while its siblings are still in flight, and
 * the resulting `process.exit(1)` tears down undici mid-socket — on Windows
 * that surfaces as a libuv assertion and exit code 127, which buries the real
 * error message. Draining first means a failure exits cleanly with 1.
 */
async function allOrFirstError(promises) {
  const settled = await Promise.allSettled(promises);
  const failed = settled.find((s) => s.status === 'rejected');
  if (failed) throw failed.reason;
  return settled.map((s) => s.value);
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
  await allOrFirstError(workers);
  return out;
}

// ------------------------------------------------------------ data lookup ---

/**
 * Total contributions over the trailing 365 days, from the PUBLIC profile
 * contribution calendar. This is NOT a lifetime commit count: it counts
 * commits, pull requests, issues, reviews and repository creations, and only
 * within the last year. The card labels it accordingly.
 */
async function fetchContributions(login) {
  const data = await graphql(
    `query($login: String!) {
       user(login: $login) {
         contributionsCollection {
           contributionCalendar { totalContributions }
         }
       }
     }`,
    { login },
  );

  const total = data?.user?.contributionsCollection?.contributionCalendar?.totalContributions;
  if (typeof total !== 'number') {
    throw new Error(
      `contributionCalendar missing for "${login}" — is the login correct?`,
    );
  }
  return total;
}

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
  // Forks are somebody else's work; they would inflate every figure on the card.
  return repos.filter((r) => !r.fork);
}

async function repoLanguages(owner, name) {
  const { res, body } = await gh(`/repos/${owner}/${name}/languages`, {
    allowStatus: [403, 404, 409],
  });
  return res.ok && body && typeof body === 'object' ? body : {};
}

/** Whole days elapsed since FIRST_COMMIT, computed in UTC (no clock drift). */
function daysBuilding(fromIso) {
  const start = Date.parse(`${fromIso}T00:00:00Z`);
  if (!Number.isFinite(start)) throw new Error(`FIRST_COMMIT is not a valid date: ${fromIso}`);
  return Math.max(1, Math.floor((Date.now() - start) / 86_400_000));
}

async function collect() {
  const [contributions, repos] = await allOrFirstError([
    fetchContributions(PROFILE_LOGIN),
    listOwnedRepos(),
  ]);

  const perRepo = await mapPool(repos, CONCURRENCY, async (r) => ({
    name: r.name,
    private: r.private,
    languages: await repoLanguages(r.owner.login, r.name),
  }));

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
    profile: PROFILE_LOGIN,
    contributions,
    repoCount: perRepo.length,
    days: daysBuilding(FIRST_COMMIT),
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

  // Honest labels: the big number is a 365-day CONTRIBUTION total, not a
  // lifetime commit count — the sub-caption says so on the card itself.
  const figures = [
    { value: group(data.contributions), caption: 'CONTRIBUTIONS', note: 'last 365 days' },
    { value: group(data.repoCount), caption: 'REPOSITORIES', note: 'forks excluded' },
    { value: group(data.days), caption: 'DAYS BUILDING', note: `since ${FIRST_COMMIT}` },
  ];

  // Left column: three rows across the 46..205 band. Pitch 54 buys room for the
  // sub-caption line; the +27/+41/+51 offsets keep a ~4px gap between a note's
  // descender and the cap-height of the NEXT row's 34px figure.
  const figureRows = figures
    .map((f, i) => {
      const top = 46 + i * 54;
      return (
        `<g class="stat f${i}">` +
        `<text class="fig" x="${LEFT_X}" y="${top + 27}">${escapeXml(f.value)}</text>` +
        `<text class="cap" x="${LEFT_X}" y="${top + 41}">${escapeXml(f.caption)}</text>` +
        `<text class="note" x="${LEFT_X}" y="${top + 51}">${escapeXml(f.note)}</text>` +
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
.note{font-size:9px;fill:var(--muted);letter-spacing:0.04em;opacity:.85}
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

  const title =
    `${group(data.contributions)} contributions in the last 365 days, ` +
    `${data.repoCount} repositories, ${data.days} days building`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="GitHub statistics">
<title>${escapeXml(title)}</title>
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
  console.log(`profile         ${data.profile}`);
  console.log(`contributions   ${group(data.contributions)}  (last 365 days, all activity types)`);
  console.log(`repos           ${data.repoCount} (forks excluded)`);
  console.log(`days building   ${data.days}  (since ${FIRST_COMMIT})`);
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
