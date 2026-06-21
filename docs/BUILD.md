# CONDUCTOR — BUILD PLAN
### Native macOS harness for autonomous multi-agent web research
*Working doc · v1.0 · 20 June 2026*

---

## 0. How to read this document

This is the master sequencing plan. It is organised as **Layers → Phases → Micro-phases**. Each micro-phase is sized to become **one scoped Antigravity prompt** (START/END markers, plain text), executed by you, then verified by re-clone. Nothing in a later phase should start until the acceptance test of the phase before it passes.

Three companion files travel with this one:
- `taste.md` — the design philosophy (the *why* and the rules).
- `design.md` — the concrete design system (tokens, type, components, motion).
- `BUILD.md` — this file (the *what* and the *when*).

**North star:** First be *as good as Conductor* at the web-agent job (parity spine). Then be *really better* with web-native features Conductor has no reason to build (the moat). Then change the category (monitoring).

---

## 1. Non-negotiable architecture principles

These hold across every phase. Violating them is the fastest way to a janky, leaky, insecure app.

1. **The engine is a separate process from the UI.** Orchestration + Playwright run in their own Node process (Electron `utilityProcess` or a forked child). The React UI never blocks, never janks, no matter how hard the swarm grinds. This single decision is what makes the app feel "smooth."
2. **Local-first.** All code, runs, screenshots, and recipes stay on the user's Mac (SQLite + disk). This matches Conductor and is a genuine trust selling point.
3. **BYOK only.** OpenRouter + local Ollama. The platform never runs inference on its own dime — no operational deficit on agent loops.
4. **Keys live in the macOS Keychain**, never in plaintext, never in the repo, never passed to the model. Use Electron `safeStorage`.
5. **Every model action is schema-validated** (Zod) before it touches the browser. The model proposes; the engine disposes.
6. **Concurrency is capped to hardware.** Default conservative (≤ machine RAM ÷ ~300 MB per context). User-settable.
7. **Modular by contract.** Engine, UI, and browser pool communicate through defined message contracts — mirrors the design ethos (independent modules, clean interfaces) and keeps each independently testable.

---

## 2. The competitive map (what "parity" means)

Conductor (Melty Labs, the coding tool) today: parallel coding agents in isolated git worktrees, a live dashboard of all threads, diff-first review-and-merge, BYOK, local-first, free. Translate each mechanic to the web domain — that is the **Spine**:

| Conductor (coding) | Conductor (our web harness) | Phase |
|---|---|---|
| Parallel agents in isolated git worktrees | Parallel agents in isolated **browser contexts** (cookies/storage/proxy/UA per agent) | 1 |
| Per-workspace: branch / files / chat / terminal / preview / diff | Per-agent: live browser view / action log / thought log / data preview / screenshot | 1 |
| Unified thread dashboard (progress, diffs, stuck) | **ThreadGrid / "Glyph Wall"** — live status per agent | 1 |
| Diff-first review & merge | **Data-first** review — approve / reject / merge / dedupe extracted rows | 1 |
| Tests / lint pass in workspace | **Schema validation (JSON-Lego)** is the test-equivalent | 2 |
| BYOK + local-first | Same (OpenRouter + Ollama, all local) | 0–1 |

The **Moat** (Phase 2) and **Category Shift** (Phase 3) are things a coding-agent tool structurally would not build.

---

## 3. THE PLAN

### LAYER A · PHASE 0 — Foundations (headless core loop)
*"Prove the brain works with no UI."* No Electron yet. Pure TypeScript + Node, runnable from the CLI.

| # | Micro-phase | Key work | Acceptance |
|---|---|---|---|
| 0.1 | Repo + tooling | pnpm workspace, TypeScript strict, ESLint/Prettier, Vitest, folder skeleton split into `packages/engine` and `apps/desktop` | `pnpm test` runs green on a stub |
| 0.2 | Provider abstraction | `LLMProvider` interface; OpenRouter adapter + Ollama adapter; streaming; model picker config | Same prompt returns from both providers via one interface |
| 0.3 | Browser primitive | Playwright wrapper: launch isolated context, navigate, extract "page state" (visible text + interactive elements w/ stable selectors), screenshot | Returns clean JSON page-state + PNG for a test URL |
| 0.4 | Loop manager | Receive `{url, goal, provider}` → build prompt from page-state → get Zod-validated action `{click \| type \| scroll \| extract \| complete}` → apply → repeat to a 5-turn safety cap | Completes a 3-step extraction on a permissive test site |
| 0.5 | Run recorder | Persist every step (thought, action, screenshot path, DOM snapshot, timestamp, token cost) to SQLite + disk | A completed run is fully reconstructable from the DB |

**Phase 0 done =** from a terminal, give a URL + goal and watch an agent finish a real multi-step extraction, with a complete replayable step log on disk. This is the spine of the playback deck, the wallet guard, and recipes — build it carefully.

---

### LAYER B · PHASE 1 — The Spine (Conductor parity)
*"As good as Conductor, for the web."* Wrap the engine in Electron, add the dashboard, scale 1 → few agents.

| # | Micro-phase | Key work | Acceptance |
|---|---|---|---|
| 1.1 | Electron shell | Main process; engine as separate `utilityProcess`; secure `preload` IPC bridge; system tray; **close-to-tray so the daemon survives window close** | Close the window → a run keeps going in the tray |
| 1.2 | App skeleton | React + Vite + Tailwind; wire `design.md` tokens; left rail + main pane; dot-grid canvas | App opens to the empty Glyph Wall, on-brand |
| 1.3 | Single-agent run view | Goal+URL+provider input; live status; action/thought log streaming over IPC; live screenshot/preview | Launch one agent, watch it work live |
| 1.4 | Run history | List past runs (SQLite); open one; step-by-step view | Re-open yesterday's run and inspect every step |
| 1.5 | BYOK settings | OpenRouter key + Ollama endpoint + model picker; stored in Keychain via `safeStorage` | Keys persist, never appear in plaintext on disk |
| 1.6 | Isolated contexts + ThreadGrid | Spin up N agents (same or different tasks), each isolated context; the live **Glyph Wall** dashboard | Run 3 agents in parallel, see all three breathing live |
| 1.7 | Data review & merge | Per-agent extracted-data table; approve/reject; merge + dedupe across agents | Merge 3 agents' rows into one clean dataset |

**Phase 1 done =** run several isolated agents in parallel, monitor them on the Glyph Wall, review and merge their data. **You are now at parity with Conductor on the web job.**

---

### LAYER C · PHASE 2 — The Moat (web-native differentiators)
*"Now really better."* Each feature hangs off the Phase-0 engine and Phase-1 dashboard.

| # | Micro-phase | Key work | Acceptance |
|---|---|---|---|
| 2.1 | Playback / time-travel deck | Scrubbable screenshot+metadata timeline; jump to any step; see thought+action at each frame | Scrub a failed run, find the bad step visually |
| 2.2 | Breakpoint + human handoff | Engine signals `BREAKPOINT` on CAPTCHA/2FA/login wall → pause → surface a live embedded `BrowserView` **on the same context** → "Resume" continues from the exact state | Hit a login wall, solve it by hand, agent resumes with full context intact |
| 2.3 | Wallet Guard | Vector-similarity loop detection over action+thought history; per-run/per-model cost meter; pre-run cost projection; settable auto-pause; acoustic + visual alert | Force a cyclic loop → app auto-pauses and flags it |
| 2.4 | Recipe record-and-replay | Serialize a successful run's deterministic action/selector sequence as a "recipe"; replay runs deterministically; LLM invoked only on a broken step | Replay a saved recipe at ~zero token cost |
| 2.5 | Self-healing selectors | On a broken recipe step, call the model to repair just that step and update the recipe | A site tweak breaks step 4; recipe auto-repairs |
| 2.6 | JSON-Lego schema enforcement | Visual schema builder; intercept output; Zod-validate; force a correction mini-loop on failure | Missing key → agent is sent back to fix it before completing |

**Phase 2 done =** you can visually debug a run, hand off and resume on a CAPTCHA, catch runaway loops, and re-run jobs almost free via recipes. **This is where Conductor cannot follow.**

---

### LAYER D · PHASE 3 — Category Shift (monitoring + scale)
*"What Conductor isn't."* Turns one-shot scraping into a sticky, recurring product.

| # | Micro-phase | Key work | Acceptance |
|---|---|---|---|
| 3.1 | Scheduling | Cron-style recurring runs; daemon executes on schedule with the window closed | A scrape fires daily on its own |
| 3.2 | Change diffs + alerts | Compare a run's output to the previous; surface deltas; native notification (+ optional webhook) | Page changes → you get a "what changed" alert |
| 3.3 | Export pipeline | CSV / JSON / Google Sheets / webhook destinations | One click sends a dataset to a Google Sheet |
| 3.4 | Recipe library | Browse/reuse saved recipes locally (cloud sync deferred) | Pick a saved recipe, run it on new input |
| 3.5 | Multi-model racing (A/B) | Same task to N models simultaneously; flag the cleanest/fastest result | Watch 3 models race; harness picks the winner |

**Phase 3 done =** Conductor is no longer "scraping on demand"; it's an autonomous web-monitoring instrument.

---

### LAYER E · PHASE 4 — Polish, hardening, distribution
*"An object that deserves to sit on your desk."*

| # | Micro-phase | Key work | Acceptance |
|---|---|---|---|
| 4.1 | Design polish | Motion pass, empty/error states, reduced-motion, full keyboard nav + focus rings (per `design.md`) | Passes the taste.md self-critique checklist |
| 4.2 | Robustness | Zombie-Chromium cleanup, memory caps, RAM-tied concurrency, crash-recovery (resume in-flight runs) | Kill the app mid-run → reopen → run resumes/recovers |
| 4.3 | Packaging | electron-builder, arm64 + universal build, app icon, DMG | A DMG builds reproducibly |
| 4.4 | Sign + notarize + auto-update | Apple Developer signing + notarization; `electron-updater` + GitHub Releases | A stranger installs the signed DMG without Gatekeeper warnings |
| 4.5 | Onboarding | First-run flow, a bundled sample recipe, in-app docs | New user reaches first successful run unaided |

---

### LAYER F · PHASE 5 — Deferred / experimental (only if validated)
Do **not** build these on the way up. Each is a trap or needs a separate decision.

- **Cross-pollination "speculative swarm."** Needs a meta-evaluator judging thought logs every few iterations (cost + latency). Prototype in isolation to prove it beats independent retries *before* committing.
- **Ghost-session auth mirroring.** Reads the user's local browser cookies to bypass logins. Legal/ToS exposure (account bans), behaves like infostealer malware to security tooling, and complicates notarization. **Hold pending a legal read; not App-Store-friendly.**
- **Custom fine-tuned model** (your doc's original Phase 2). Likely unnecessary — frontier models improve faster than you can fine-tune a 31B. Revisit only if token cost becomes the binding constraint and recipes haven't solved it.
- **Monetization infra.** $5/mo subscription, license server, recipe cloud sync, Lemon Squeezy billing. Gated on having a payment entity (real billing stays in test mode until an entity exists). Reuse your Churnaut stack knowledge (Supabase + Vercel) when you get here.

---

## 4. The full tool stack (with cost)

| Concern | Tool | Why this one | Cost |
|---|---|---|---|
| Desktop shell | **Electron** | Most vibe-codeable shell (largest training corpus); proven for premium apps (Linear, Cursor, VS Code) | Free (OSS) |
| Bundler / dev | **Vite** | Fast HMR, clean React setup | Free |
| UI | **React + TypeScript** | Huge ecosystem, type-safe IPC contracts | Free |
| Styling | **Tailwind CSS** | Token-driven; design system maps directly to config | Free |
| Components | **shadcn/ui** (selectively) | Unstyled-ish primitives you restyle to the Nothing system | Free |
| State | **Zustand** | Minimal, no boilerplate vs Redux | Free |
| Motion | **Framer Motion** | transform/opacity-only animation, reduced-motion support | Free |
| Automation | **Playwright** | Best isolation + reliability; Node-native | Free |
| Local DB | **better-sqlite3** | Sync, fast, simple; perfect for run history/recipes | Free |
| Validation | **Zod** | Action schemas + JSON-Lego enforcement | Free |
| Inference (build/test) | **OpenRouter** (pay-as-you-go) | Cheap models (Flash / mini / Kimi) for your own testing | ~cents per test run |
| Inference (local) | **Ollama** | Free local models; zero token cost | Free (needs Mac RAM) |
| Packaging | **electron-builder** | DMG, universal builds, signing hooks | Free |
| Auto-update | **electron-updater + GitHub Releases** | Free hosting for updates | Free |
| Error tracking | **Sentry** (free tier) | Catch crashes in the wild | Free tier |
| Fonts | **Departure Mono / DotGothic16** (dots), **Geist** (body), **Geist Mono / JetBrains Mono** (data) — all OFL | Capture the Nothing aesthetic **legally** (see warning below) | Free (OFL) |
| Distribution license | **Apple Developer Program** | Required to sign + notarize + ship | **$99 / year** |

**Realistic cost to reach a shippable MVP: ~$99 (Apple) + a few dollars of OpenRouter testing. Everything else is $0.** Monetization infrastructure adds cost only in Phase 5.

> ⚠️ **Font / IP warning:** Do **not** ship Nothing's actual `NDot` / `NDOT 55` typeface — it is Nothing's proprietary brand asset and using it would be both an IP problem and brand-confusing. Use the OFL look-alikes above. `design.md` specifies exact replacements.

---

## 5. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| UI jank under heavy scraping | High if mis-architected | Engine in a separate process (Principle #1); cap concurrency to RAM |
| Zombie Chromium / memory leaks | High (AI-generated code leaks here) | Explicit context teardown; process supervisor; Phase 4.2 hardening |
| Notarization / signing pain | Certain | Budget a frustrating weekend; do it in 4.4, not earlier |
| Token burn during your own testing | Medium | Default to cheap models + Ollama; Wallet Guard early (2.3) |
| Scope creep (9+ features at once) | High | Ship layer by layer; Phase 5 stays parked |
| Legal exposure (bypass/cookie features) | High if built | Keep them in Phase 5 behind a legal read |
| Out-polishing a funded competitor | Guaranteed loss | Win on web-native features, not on being prettier than a $22M team |

---

## 6. Definition of "done" per layer (the only milestones that matter)

- **Phase 0:** a CLI agent completes a real multi-step extraction with a full replay log.
- **Phase 1:** parity — parallel isolated agents, live dashboard, review-and-merge.
- **Phase 2:** the moat — visual playback, breakpoint handoff, wallet guard, recipe replay.
- **Phase 3:** the shift — scheduled runs, change diffs, export.
- **Phase 4:** a signed, notarized DMG a stranger can install.
- **Phase 5:** only what validation justifies.

Build the spine. Hang the moat on it. Then change the category. Don't skip ahead.
