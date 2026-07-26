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

Everything in this section is in the repos above — each badge is something I have shipped with, not something I have read about.

**Product**

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white) ![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white) ![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white) ![Radix UI](https://img.shields.io/badge/Radix_UI-161618?style=for-the-badge&logo=radixui&logoColor=white) ![Framer Motion](https://img.shields.io/badge/Framer_Motion-0055FF?style=for-the-badge&logo=framer&logoColor=white) ![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)

**Backend and data**

![Python](https://img.shields.io/badge/Python-3670A0?style=for-the-badge&logo=python&logoColor=ffdd54) ![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white) ![Node.js](https://img.shields.io/badge/Node.js-6DA55F?style=for-the-badge&logo=nodedotjs&logoColor=white) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white) ![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white) ![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white) ![RocksDB](https://img.shields.io/badge/RocksDB-2B303B?style=for-the-badge)

**Automation and acquisition**

![patchright](https://img.shields.io/badge/patchright-2EAD33?style=for-the-badge) ![camoufox](https://img.shields.io/badge/camoufox-8B4A2B?style=for-the-badge) ![curl__cffi](https://img.shields.io/badge/curl__cffi-073551?style=for-the-badge&logo=curl&logoColor=white) ![crawl4ai](https://img.shields.io/badge/crawl4ai-4B5563?style=for-the-badge) ![BeautifulSoup](https://img.shields.io/badge/BeautifulSoup-3776AB?style=for-the-badge) ![Bright Data](https://img.shields.io/badge/Residential_Proxies-0F62FE?style=for-the-badge)

**AI and agents**

![Anthropic](https://img.shields.io/badge/Anthropic_Claude-D97757?style=for-the-badge&logo=anthropic&logoColor=white) ![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white) ![LangGraph](https://img.shields.io/badge/LangGraph-1C3C3C?style=for-the-badge&logo=langchain&logoColor=white) ![Pydantic](https://img.shields.io/badge/Pydantic-E92063?style=for-the-badge&logo=pydantic&logoColor=white) ![MCP](https://img.shields.io/badge/Model_Context_Protocol-000000?style=for-the-badge)

**Systems**

![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white) ![Tokio](https://img.shields.io/badge/Tokio-1A1A1A?style=for-the-badge) ![axum](https://img.shields.io/badge/axum-4B5563?style=for-the-badge)

**Infrastructure**

![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white) ![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2671E5?style=for-the-badge&logo=githubactions&logoColor=white) ![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white) ![DigitalOcean](https://img.shields.io/badge/DigitalOcean-0167FF?style=for-the-badge&logo=digitalocean&logoColor=white) ![AWS SES](https://img.shields.io/badge/AWS_SES-FF9900?style=for-the-badge&logo=amazonwebservices&logoColor=white) ![Git](https://img.shields.io/badge/Git-F05033?style=for-the-badge&logo=git&logoColor=white)

## Also work with

Not used in the repos above, because the stack there did not call for it. Listed separately so the section above stays exactly what it says it is.

![Kubernetes](https://img.shields.io/badge/Kubernetes-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white)

## Foundations

Before April 2026 my base was web foundations only — HTML, CSS, JavaScript, PHP, MySQL. First commit 2026-04-25; everything above is what came after. The counts in the card are generated nightly from the API, not typed by hand.

## Contact

GitHub: [@bedisfriaa](https://github.com/bedisfriaa)

<!-- TODO: add email and personal site here once decided -->
