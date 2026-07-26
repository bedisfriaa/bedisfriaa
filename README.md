# Friaa Bedis

I build full-stack products and the automation that feeds them. Started April 2026.

![](./assets/architecture.svg)

## What I build

Most of my time goes into RevFlowLab, a multi-tenant marketing platform on Next.js, TypeScript and Supabase. Tenant isolation lives in Postgres row-level security rather than in application checks, so a missed `where` clause in a route cannot leak another tenant's rows. It is deployed. It has no users yet. Around it sits the machinery that feeds it: a Python acquisition engine that escalates through five tiers of evasion, an email warming system that derives sending caps from live inbox and spam rates, and an LLM evaluation pipeline that refuses to act on a single negative signal.

I work alone, so I bias toward systems that fail loudly and recover without me: locks that survive a crashed process, proxy sessions retired on a predicted ban instead of an observed one, migrations and tests as the only contract I trust. Two repos are Rust and I am learning it in public — bastion is a study of a problem space, not a finished system, and I would rather say that than round it up.

![](./assets/stats.svg)

## Systems

| Project | What it is | The hard part |
| --- | --- | --- |
| **revflowlab** | Multi-tenant marketing platform. Next.js, TypeScript, Supabase. | 352 API routes, 225 migrations, 4,667 tests. Tenant isolation enforced by Postgres RLS, not application checks. |
| **hunter / scraper_core** | Adversarial web acquisition engine. | Five-tier escalation ladder that starts at a *predicted* tier from a learned per-domain difficulty model. Hand-built cursor humanization: Bézier paths, tremor, overshoot-and-correct. Proxy sessions retired before a ban, not after. |
| **warming** | Email deliverability infrastructure. | Day-based warming ramp, health-scored sending caps derived from live inbox/spam rate, IMAP engagement simulation. |
| **critique-agent** | LLM evaluation pipeline. LangGraph, Anthropic Batches API. | A confirmation-threshold gate that refuses to promote a "the model was wrong" signal until N independent confirmations — so client preference is never mistaken for miscalibration. |
| **bastion** | Rust workspace, 9 crates, 181 tests. Hybrid retrieval over vector, lexical and graph indices with per-tenant envelope encryption. | Built to learn the problem space. The TEE layer is simulated and the WAL is in-memory — both phase-0. |
| **polar-hands** | Rust, 6,800 LOC, 107 tests. OS-level input actuation. | A crash-safe FIFO lock with TTL heartbeat, so a dead session cannot deadlock the queue. |

## Stack

**Product**
TypeScript, Next.js, React, Tailwind, Supabase / Postgres, Vitest

**Automation**
Python, patchright, curl_cffi, FastAPI, residential proxy orchestration

**Systems**
Rust (learning in the open), SQLite, RocksDB

**Infrastructure**
Docker, GitHub Actions, Vercel, DigitalOcean, AWS SES

## Foundations

Before April 2026 my base was web foundations only — HTML, CSS, JavaScript, PHP, MySQL. First commit 2026-04-25; everything above is what came after. The counts in the card are generated nightly from the API, not typed by hand.

## Contact

GitHub: [@bedisfriaa](https://github.com/bedisfriaa)

<!-- TODO: add email and personal site here once decided -->
