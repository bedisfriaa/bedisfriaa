# GitHub Profile Rebuild — Design

**Date:** 2026-07-26
**Repo:** `bedisfriaa/bedisfriaa` (public profile README)
**Status:** design approved, pending spec review

---

## 1. Problem

The current profile README is GPRM-generated boilerplate: bio reads "just a dev", the tech-stack badge wall leads with HTML/CSS/PHP/MySQL, and every stats card is broken because all 8 repos are private and third-party services cannot see them.

Three failures:

1. **Stats are wrong.** `github-readme-stats` and `streak-stats` run on third-party tokens that cannot read private repos. No external service can ever fix this.
2. **The skills listed are the wrong skills.** The badges describe a pre-2026 web foundation (PHP, MySQL, NumPy, Pandas, Prometheus, Grafana — none of which appear in any repo) rather than what is actually built.
3. **No differentiation.** Nothing about the profile signals the actual work.

## 2. Audience (owner-selected)

- **Peer developers / OSS credibility**
- **Founder credibility / investors**

Both reward depth, systems thinking, and velocity. Neither rewards keyword coverage. This rules out a badge wall as the centerpiece.

## 3. Hard constraints (researched, not assumed)

| Constraint | Consequence |
|---|---|
| GitHub markdown strips `<script>`, `<style>`, inline `<svg>`, event handlers | **Framer Motion and anime.js cannot run in a README.** Animation must be a referenced `.svg` file with CSS `@keyframes` in an internal `<style>` block. Verified against the raw `Platane/snk` output SVG, which uses exactly this technique. |
| An `<img>`-loaded SVG is a hermetic document | No external fonts, no external images. **System font stack only.** |
| Firefox renders camo-proxied animated SVGs as static for some users ([github/markup#1864](https://github.com/github/markup/issues/1864), closed stale) | **Frame zero must already be a good frame.** Animation is enhancement, never load-bearing. |
| Camo caches images aggressively | A serverless "live" endpoint returns a cached image anyway. **This is why a Vercel renderer was rejected.** |
| All repos are private | No third-party stats service can ever report true numbers. Only a token the owner holds can. |

## 4. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Nightly GitHub Action → committed SVG** | Free on public repos, no hosting, no cold starts, no third-party token custody. Camo caching removes serverless's only advantage. |
| D2 | **Commit counts from REST pagination, not `contributionsCollection`** | `contributionsCollection` currently returns 0 across the board (see §5). REST `Link: rel="last"` per repo is ground truth and independent of any profile privacy setting. |
| D3 | **All repos stay private** | Owner decision. Profile proves capability by architecture and specificity rather than readable code. |
| D4 | **Architecture hero + stats card** | Two artifacts with separate jobs. |
| D5 | **Headline skills = full-stack product engineering + adversarial automation** | Owner-stated: these are defensible cold. Rust/retrieval and AI-agent infrastructure are **not** headline claims. |
| D6 | **Bastion and Polar appear as "systems I've built", with no expertise claim** | Credit for shipping without being on the hook to defend design decisions. |
| D7 | **State the timeline explicitly: "Started April 2026"** | Verified below. Converts a new-looking account from liability to headline. |

## 5. The contribution-graph defect

`contributionsCollection` returns `totalCommitContributions: 0`, `restrictedContributionsCount: 0`, `totalRepositoryContributions: 0`, calendar total `0` — despite commits being correctly attributed (`author.login: bedisfriaa`, email `badisfriaa70@gmail.com` linked and verified).

Repo *creation* counting as zero is the tell: this is **"Include private contributions on my profile" switched OFF**, combined with every repo being private.

**Action for owner:** Settings → Profile → Contributions & Activity → enable "Include private contributions on my profile." The Action-generated card shows true numbers either way, but the native graph sits directly above the README — an empty graph beside a card claiming 2,659 commits reads as fabricated.

## 6. Verified scale

```
First commit ever   2026-04-25   (revflowlab)
Polar constellation 2026-06-01
Bastion             2026-06-07
Today               2026-07-26

92 days · 2,659 commits · ~29 commits/day
```

| Repo | Commits | Language |
|---|---:|---|
| revflowlab | 2,105 | TypeScript |
| polar-engine | 445 | Python |
| polar-sight | 53 | Python |
| forge | 32 | Python |
| prodromus | 16 | Python |
| bastion | 5 | Rust |
| corag | 2 | — |
| revflowlab-webhooks | 1 | TypeScript |

## 7. Skill map (evidence-backed, five parallel audits)

### Headline — defensible cold

**Full-stack product engineering** — `revflowlab`
~98,900 LOC · 2,012 TS/TSX files · 97 pages · 352 API route handlers · 225 SQL migrations · 564 test files / 4,667 test cases · 17 webhook endpoints.
Multi-tenant isolation enforced at the database layer (81 RLS policy statements across 29 migrations). Append-only audit tables enforced by Postgres rules, not application convention. Auth hardening: `getSession()` → `getUser()` server-side. Paddle webhook with raw-body HMAC-SHA256 verification against the provider's actual signing scheme. Tier-gating as a domain concept with an unshippable tier made unrepresentable in the type system.

**Adversarial web automation** — `revflowlab/hunter`, `scraper_core`
Five-tier escalation ladder: TLS-impersonated HTTP (curl_cffi) → stealth headless → +residential proxy → headful human-simulation → max-evasion. Starts at a *predicted* tier from a learned per-domain difficulty model that generalizes from exact-domain history to CDN-class history, backed by a telemetry table. Hand-built cursor humanization: cubic Bézier paths, smoothstep easing, per-step tremor, overshoot-and-correct, momentum scroll deceleration. Proxy sessions retired after 2 challenge responses — before a hard ban. 15 persistent fingerprinted identities on LRU rotation with cooldowns. Crash-resumable batch checkpointing. Adaptive per-domain throttling.
Separately: `chrome_inject.py` attaches to an already-running Chrome by reading `DevToolsActivePort`, because Chrome ≥136 blocked the debugging flag against the default profile and ≥144 moved it to a dynamic random port.

**Email deliverability** — `revflowlab/warming`
Day-based warming ramp (≤7d: 3/acct, 0% external; ≤14d: 8/acct, 20%; >14d: 20/acct, 40%). Health score 0–100 from inbox/spam rate mapped to daily volume caps (20→500). IMAP polling with SMTP auto-reply for engagement signal. SES/Resend bounce-complaint handling.

### Supporting — built, no expertise claim

**Rust systems** — `bastion` (9 crates, 5,257 LOC, 181 tests), `polar-hands` (6,800 LOC, 107 tests)
Real Reciprocal Rank Fusion across four heterogeneous indices (usearch HNSW, tantivy BM25, predicate filter, petgraph multi-hop) — all four paths exercised end-to-end. Per-tenant envelope encryption with correct KEK rotation, crypto-shred verified unrecoverable. Merkle tamper-evidence with working inclusion proofs. Time-travel reads over signed segments. Self-calibrating scalar quantizer.
`polar-hands`: crash-safe FIFO lock with TTL heartbeat, Windows DPAPI credential encryption, TOTP, typed stop-reason taxonomy, RNG-seeded pure motion math kept unit-testable.

**LLM / agent infrastructure** — `revflowlab/critique-agent`, `polar-*` constellation
Tool-calling agent loop with content-addressed caching and per-tier LLM budget gating. Anthropic Batches API for bulk inference with async poll/process split. LangGraph state machine routing three request types, with a confirmation-threshold gate that refuses to promote a "model was wrong" signal until N independent confirmations. Six MCP servers on the low-level official SDK with protocol handshake tests. All seven Claude Code hook events wired across 15+ scripts, including transparent content-addressed context virtualization.
~55 `polar-*` directories, of which ~10–12 are substantial systems, ~15 small utilities, remainder stubs or explicitly phase-0.

### Foundations — pre-April 2026

HTML, CSS, JavaScript, PHP, MySQL. One honest line. Frames the story as progression rather than a gap.

### Removed from the current README (no evidence in any repo)

NumPy · Pandas · Prometheus · Grafana · Playwright (patchright is used deliberately instead).

## 8. Honesty guardrails — must never appear

- **"TEE-backed"** — `bastion-tee` is simulated: `blake3(identity)` as measurement, no SEV-SNP/TDX quote generation, no remote verification.
- **"Write-ahead log" / durability claims for bastion** — `wal.rs` is an in-memory `VecDeque`, marked Phase-0 in-source. Durability comes from RocksDB underneath.
- **Any security claim about the bastion API** — it has no auth layer.
- **`browser-harness`** — an unmodified clone of `browser-use/browser-harness`. Not the owner's work. Must not be listed.
- **Traction language** — RevFlowLab is deployed but pre-users. No revenue, customer, or usage claims.
- **Multi-provider AI orchestration** — OpenAI is a declared dependency; nearly all generation routes through Anthropic.
- **Test counts as coverage** — 4,667 is a raw `it()`/`test()` count. No coverage report exists.

## 9. Repo structure

```
bedisfriaa/
├── README.md
├── assets/
│   ├── architecture.svg      hand-authored, animated, stable
│   └── stats.svg             regenerated nightly by the Action
├── scripts/
│   └── render-stats.mjs      REST pagination + GraphQL → SVG string
└── .github/workflows/
    └── stats.yml             nightly cron + workflow_dispatch
```

## 10. README section order

1. Name + positioning line + **"Started April 2026"**
2. `architecture.svg`
3. **What I build** — two paragraphs, maximum specificity
4. `stats.svg`
5. **Systems** — one row per project: what it is · the hard part · the stack
6. **Stack, grouped by role** — Product/TS · Automation/Python · Systems/Rust · Infra
7. **Foundations** — one line
8. Contact

## 11. `architecture.svg`

- ~900×400 viewBox, `width="100%"`
- Depicts the **RevFlowLab system** — the escalation ladder feeding the services feeding the product — not bastion. Per D5, the hero shows what the owner can defend.
- Pulses travel edges on a staggered ~12s loop
- Frame zero is the completed diagram
- `ui-monospace, SFMono-Regular, Menlo, monospace`
- `@media (prefers-color-scheme: dark)` inside the SVG
- Budget: **< 15KB**

## 12. `stats.svg`

- Bars draw left→right, values reveal on a stagger, commit total lands last
- Data: per-repo REST pagination counts (D2); language split from GraphQL
- **Count-up animation deferred.** True CSS count-up requires a per-digit sliding strip — roughly doubles file size and complexity for ~20% more impact. Ship staggered reveal first.

## 13. Workflow

- Nightly cron + `workflow_dispatch` for manual runs
- Reads a fine-grained PAT from repo secrets (read-only: metadata + contents)
- Commits `assets/stats.svg` only when content changes
- Free: Actions minutes are unlimited on public repos

## 14. Verification

Neither SVG can be fully tested outside GitHub. Before merging to `main`:
- render locally and check both color schemes
- confirm file size budget
- confirm frame zero standalone
- push to a branch, view the rendered page, confirm animation
- trigger the workflow manually and confirm the committed SVG matches expectations

## 15. Open items

Owner deferred pending a live preview:
- Final positioning line (working draft: *"I build full-stack products and the automation that feeds them."*)
- Whether to name RevFlowLab publicly or describe it generically
- Location / availability / contact
- Exact wording of the Foundations line
